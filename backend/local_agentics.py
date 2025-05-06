from pydantic import BaseModel
from openai import OpenAI, AsyncOpenAI
from openai.types.responses import ParsedResponse, Response, WebSearchToolParam
from openai.types.images_response import ImagesResponse
from typing import Literal


def system_message(text: str):
    return {"role": "system", "content": text}

def user_message(text: str):
    return {"role": "user", "content": text}

def assistant_message(text: str):
    return {"role": "assistant", "content": text}

class LLM:
    """
    A class for interacting with language models through chat completions.

    This class provides a flexible interface for chat-based interactions with language models,
    supporting structured outputs, tool usage, and conversation management.

    Args:
        system_prompt (str, optional): Initial system prompt to set context. Defaults to None.
        model (str, optional): The model identifier to use. Defaults to "gpt-4.1-mini".
        client (OpenAI, optional): OpenAI client instance. If None, creates new instance.
        messages (list[dict], optional): Initial conversation messages. Defaults to None.

    Attributes:
        client (OpenAI): The OpenAI client instance
        system_prompt (str): The system prompt used for context
        model (str): The model identifier being used
        messages (list[dict]): The conversation history
    """

    def __init__(
        self,
        system_prompt: str = None,
        model: str = "gpt-4.1-mini",
        client: OpenAI = None,
        messages: list[dict] = None,
        max_retries: int = 3,
        internet: bool = True,
    ):
        self.client = client or OpenAI(max_retries=max_retries)
        self.system_prompt = system_prompt
        self.model = model
        self.messages = messages or []
        self.internet = internet
        if self.system_prompt:
            self.messages.append(system_message(self.system_prompt))

    def _chat(self, **kwargs) -> Response:
        """
        Internal method for raw chat completions.

        Args:
            **kwargs: Additional arguments passed to chat completion.

        Returns:
            ChatCompletion: Raw completion response from the model
        """
        if self.internet and not self.model.startswith("o") and not self.model.endswith("nano"): # o series models don't support internet
            kwargs.setdefault("tools", []).append(
                WebSearchToolParam(
                    type="web_search_preview",
                    search_context_size="high",
                    user_location={"type": "approximate"}
                )
            )
        return self.client.responses.create(model=self.model, input=self.messages, **kwargs)

    def _cast(self, response_format=None, **kwargs) -> ParsedResponse:
        """
        Internal method for structured chat completions.

        Args:
            response_format (BaseModel, optional): Expected response format. Defaults to None.
            **kwargs: Additional arguments passed to chat completion.

        Returns:
            ChatCompletion: Parsed completion response with structured data
        """
        if self.internet and not self.model.startswith("o") and not self.model.endswith("nano"): # o series models don't support internet
            kwargs.setdefault("tools", []).append(
                WebSearchToolParam(
                    type="web_search_preview",
                    search_context_size="high",
                    user_location={"type": "approximate"}
                )
            )
        return self.client.responses.parse(
            model=self.model,
            input=self.messages,
            text_format=response_format,
            **kwargs
        )

    def chat(
        self,
        prompt: str = None,
        response_format: BaseModel = None,
        **kwargs,
    ):
        """
        Main method for chat completions with full functionality.

        Supports structured outputs, tool usage, and maintains conversation history.
        Can handle both regular text responses and tool-based interactions.

        Args:
            prompt (str, optional): The input prompt. Defaults to None.
            response_format (BaseModel, optional): Expected response format. Defaults to None.
            **kwargs: Additional arguments passed to chat completion.

        Returns:
            Union[str, BaseModel]: The model's response, either as text or structured data.
                If response_format is provided, returns validated BaseModel instance.
                If no response_format, returns string response.
                For tool calls, returns the final response after tool execution.

        Raises:
            ValueError: If no response is received from the model
        """
        if prompt:
            self.messages.append(user_message(prompt))

        if self.model.startswith("o"):
            kwargs.pop('temperature', None) # Remove temperature for o-series models
            
        if response_format:
            response = self._cast(
                response_format=response_format,
                **kwargs,
            )
            raw_text = response.output[-1].content[0].text
            self.messages.append(assistant_message(raw_text))

            return response.output_parsed

        else:
            response = self._chat(**kwargs)
            self.messages.append(assistant_message(response.output_text))
            return response.output_text

    def _create_image(
        self,
        prompt: str,
        model: Literal["gpt-image-1"] = "gpt-image-1",
        n: int = 1,
        size: Literal["1024x1024", "1024x1536", "1536x1024", "auto"] = "auto",
        quality: Literal["low", "medium", "high", "auto"] = "auto",
        background: Literal["transparent", "opaque", "auto"] = "auto",
        output_format: Literal["png", "jpeg", "webp"] = "png",
        output_compression: int = 100,
        moderation: Literal["low", "auto"] = "auto",
        user: str = None,
        **kwargs
    ) -> dict:
        return self.client.images.generate(
            model=model,
            prompt=prompt,
            n=n,
            size=size,
            quality=quality,
            background=background,
            output_format=output_format,
            output_compression=output_compression,
            moderation=moderation,
            user=user,
            **kwargs
        )

    def create_image(
        self,
        prompt: str,
        size: Literal["small", "medium", "large"] = "medium",
        quality: Literal["low", "medium", "high", "auto"] = "auto",
        **kwargs
    ) -> str:
        size_map = {
            "small": "1024x1024",
            "medium": "1024x1536",
            "large": "1536x1024"
        }
        resolved_size = size_map.get(size, "1024x1536")

        response: ImagesResponse = self._create_image(prompt=prompt, size=resolved_size, quality=quality, **kwargs)
        return response.data[0].b64_json


# Start of Selection
class ALLM:
    """
    Async version of the LLM class for interacting with language models asynchronously.

    Args:
        system_prompt (str, optional): Initial system prompt to set context. Defaults to None.
        model (str, optional): The model identifier to use. Defaults to "gpt-4.1-mini".
        client (AsyncOpenAI, optional): AsyncOpenAI client instance. If None, creates new instance.
        messages (list[dict], optional): Initial conversation messages. Defaults to None.

    Attributes:
        client (AsyncOpenAI): The AsyncOpenAI client instance
        system_prompt (str): The system prompt used for context
        model (str): The model identifier being used
        messages (list[dict]): The conversation history
    """
    def __init__(
        self,
        system_prompt: str = None,
        model: str = "gpt-4.1-mini",
        client: AsyncOpenAI = None,
        messages: list[dict] = None,
        max_retries: int = 3,
    ):
        self.client = client or AsyncOpenAI(max_retries=max_retries)
        self.system_prompt = system_prompt
        self.model = model
        self.messages = messages or []
        if self.system_prompt:
            self.messages.append(system_message(self.system_prompt))

    async def _chat(self, internet=True, **kwargs) -> Response:
        """Async internal method for raw chat completions."""
        if internet and not self.model.startswith("o") and not self.model.endswith("nano"): # o series models don't support internet
            kwargs.setdefault("tools", []).append(
                WebSearchToolParam(
                    type="web_search_preview",
                    search_context_size="high",
                    user_location={"type": "approximate"}
                )
            )
        return await self.client.responses.create(
            model=self.model,
            input=self.messages,
            **kwargs,
        )

    async def _cast(self, response_format=None, internet=True, **kwargs) -> ParsedResponse:
        """Async internal method for structured chat completions."""
        if internet and not self.model.startswith("o") and not self.model.endswith("nano"): # o series models don't support internet
            kwargs.setdefault("tools", []).append(
                WebSearchToolParam(
                    type="web_search_preview",
                    search_context_size="high",
                    user_location={"type": "approximate"}
                )
            )
        return await self.client.responses.parse(
            model=self.model,
            input=self.messages,
            text_format=response_format,
            **kwargs,
        )

    async def chat(
        self,
        prompt: str = None,
        response_format: BaseModel = None,
        **kwargs,
    ):
        """Async main method for chat completions."""
        if prompt:
            self.messages.append(user_message(prompt))

        if self.model.startswith("o"):
            kwargs.pop('temperature', None) # Remove temperature for o-series models

        if response_format:
            response = await self._cast(response_format=response_format, **kwargs)
            raw_text = response.output[-1].content[0].text
            self.messages.append(assistant_message(raw_text))
            return response.output_parsed
        else:
            response = await self._chat(**kwargs)
            self.messages.append(assistant_message(response.output_text))
            return response.output_text

    async def _create_image(
        self,
        prompt: str,
        model: Literal["gpt-image-1"] = "gpt-image-1",
        n: int = 1,
        size: Literal["1024x1024", "1024x1536", "1536x1024", "auto"] = "auto",
        quality: Literal["low", "medium", "high", "auto"] = "auto",
        background: Literal["transparent", "opaque", "auto"] = "auto",
        output_format: Literal["png", "jpeg", "webp"] = "png",
        output_compression: int = 100,
        moderation: Literal["low", "auto"] = "auto",
        user: str = None,
        **kwargs
    ) -> dict:
        return await self.client.images.generate(
            model=model,
            prompt=prompt,
            n=n,
            size=size,
            quality=quality,
            background=background,
            output_format=output_format,
            output_compression=output_compression,
            moderation=moderation,
            user=user,
            **kwargs
        )

    async def create_image(
        self,
        prompt: str,
        size: Literal["square", "landscape", "portrait"] = "landscape",
        quality: Literal["low", "medium", "high", "auto"] = "auto",
        **kwargs
    ) -> str:
        size_map = {
            "square": "1024x1024",
            "portrait": "1024x1536",
            "landscape": "1536x1024"
        }
        resolved_size = size_map.get(size, "1536x1024")

        response: ImagesResponse = await self._create_image(prompt=prompt, size=resolved_size, quality=quality, **kwargs)
        return response.data[0].b64_json


if __name__ == "__main__":
    from pydantic import BaseModel
    class Response(BaseModel):
        response: str

    llm = LLM(model="gpt-4.1-nano")
    print(llm.chat(prompt="hey", response_format=Response))


if __name__ == "__main__":
    import asyncio
    import time

    async def main():
        allm = ALLM()
        start_time = time.time()

        # Create 10 requests
        requests = [
            allm.chat("Tell me a fun fact about number " + str(i))
            for i in range(10)
        ]

        # Gather all responses asynchronously
        responses = await asyncio.gather(*requests)

        end_time = time.time()
        total_time = end_time - start_time

        # Print results
        print(f"\nCompleted 10 requests in {total_time:.2f} seconds")
        print("\nResponses:")
        for i, response in enumerate(responses):
            print(f"\nRequest {i}:")
            print(response)

    # Run the async main
    asyncio.run(main())


