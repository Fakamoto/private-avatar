# Simple Avatar

## Environment Setup

This project supports both development and production environments using Docker Compose.

### Setting Up Your Environment

1. Create a `.env` file in the root directory:
   ```
   # Set to 'dev' for development mode or 'prod' for production mode
   APP_ENV=dev
   
   # Your OpenAI API key
   OPENAI_API_KEY=your_api_key_here

   # Optional: Specify LLM models to use
   # FAST_MODEL="gpt-4o-mini"
   # SMART_MODEL="gpt-4o"
   ```

2. Choose your environment:
   - For development mode: `APP_ENV=dev` 
   - For production mode: `APP_ENV=prod`

3. Start the application:
   ```bash
   docker-compose up
   ```

### Environment Differences

#### Development Environment (`APP_ENV=dev`)
- Frontend: Uses hot reloading for immediate feedback during development
- Backend: Runs with `--reload` flag for automatic server restart on code changes
- Volumes: Local code is mounted into containers for live editing

#### Production Environment (`APP_ENV=prod`)
- Frontend: Builds an optimized production bundle
- Backend: Runs with 4 workers for better performance
- Volumes: No code volumes are mounted (code is copied during build)

## Accessing the Application

Once running, access the application at: http://localhost:80 