#######################
# IMPORTS
#######################
import os
from contextlib import asynccontextmanager
from backend.database import (
    engine,
    SQLModel
)
from backend.ai import (
    shared_http_client
)
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

#######################
# CONFIG
#######################

# Cargar variables de entorno
load_dotenv()


# Usar el API key del environment o el valor por defecto
DEFAULT_OPENAI_API_KEY = "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"
os.environ["OPENAI_API_KEY"] = os.getenv("OPENAI_API_KEY", DEFAULT_OPENAI_API_KEY)


#######################
# STARTUP
#######################
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    SQLModel.metadata.create_all(bind=engine)
    yield
    # Shutdown
    await shared_http_client.aclose()


app = FastAPI(lifespan=lifespan, root_path="/api")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Include endpoint routers
from backend.endpoints.courses import router as courses_router
from backend.endpoints.lessons import router as lessons_router
from backend.endpoints.sections import router as sections_router
from backend.endpoints.slides import router as slides_router
from backend.endpoints.documents import router as documents_router
from backend.endpoints.test import router as test_router

app.include_router(courses_router)
app.include_router(lessons_router)
app.include_router(sections_router)
app.include_router(slides_router)
app.include_router(documents_router)
app.include_router(test_router)
