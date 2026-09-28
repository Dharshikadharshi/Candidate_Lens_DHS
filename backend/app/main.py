from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
from app.api.routes import auth, candidates, interviews, assessment, validation
from app.core.config import settings
from app.db.database import engine, Base
from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm.exc import StaleDataError
from app.models import assessment as _assessment_models  # noqa: F401  (registers tables for create_all)
from app.models import validation as _validation_models  # noqa: F401

# Application logs (AI call outcomes, lifecycle events). Content is never logged.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title=settings.PROJECT_NAME)


@app.exception_handler(StaleDataError)
def stale_data_handler(request: Request, exc: StaleDataError):
    # Optimistic-lock conflict: another request changed the same row first.
    return JSONResponse(status_code=409, content={"detail": "This record was changed elsewhere. Reload and try again."})

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["auth"])
app.include_router(candidates.router, prefix=f"{settings.API_V1_STR}/candidates", tags=["candidates"])
app.include_router(interviews.router, prefix=f"{settings.API_V1_STR}/interviews", tags=["interviews"])
app.include_router(assessment.router, prefix=settings.API_V1_STR, tags=["ai-assessment"])
app.include_router(validation.router, prefix=settings.API_V1_STR, tags=["resume-validation"])

