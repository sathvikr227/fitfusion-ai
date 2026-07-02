from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ML_SERVICE_API_KEY: str = ""
    MODEL_DIR: Path = Path("./models")
    LOG_LEVEL: str = "info"


settings = Settings()
