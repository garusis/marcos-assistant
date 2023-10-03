from pydantic import BaseModel, validator
import re
import os


class EnvModel(BaseModel):
    WEBHOOK_VERIFY_TOKEN: str
    WEBHOOK_QUEUE_PROCESSOR_URL: str
    WHATSAPP_MESSAGING_TOKEN: str
    WHATSAPP_PHONE_ID: str
    WHATSAPP_MESSAGE_LIMIT: int
    WHATSAPP_ACCOUNT_ID: str
    GC_PROJECT_ID: str
    GC_TASK_LOCATION: str
    GC_TASK_CHAT_QUEUE: str
    GC_SERVICE_ACCOUNT_EMAIL: str
    OPENAI_CHAT_MODEL: str
    TIKTOKEN_CHAT_MODEL: str
    OPENAI_TRANSCRIPTION_MODEL: str
    OPENAI_MAX_TOKENS: int
    OPENAI_MAX_RESPONSE_TOKENS: int
    OPENAI_MESSAGE_TOKENS_PADDING: int
    OPENAI_INITIAL_PROMPT: str
    OPENAI_API_KEY: str
    CONTACTS_WHITE_LIST: List[str]
    MODERATOR_PHONE_LIST: List[str]

    @validator('*')
    def empty_str_to_none(cls, v):
        if not v.strip():
            return None
        return v.strip()

    @validator('WHATSAPP_MESSAGE_LIMIT', 'OPENAI_MAX_TOKENS', 'OPENAI_MAX_RESPONSE_TOKENS', 'OPENAI_MESSAGE_TOKENS_PADDING', pre=True)
    def str_to_number(cls, v):
        return int(v)

    @validator('CONTACTS_WHITE_LIST', 'MODERATOR_PHONE_LIST', pre=True)
    def str_to_list(cls, v):
        return [x.strip() for x in v.split(',') if x]

    @validator('TIKTOKEN_CHAT_MODEL', pre=True)
    def validate_tiktoken_chat_model(cls, v):
        valid_values = ['gpt-3.5-turbo', 'gpt-4']
        if str(v).strip() in valid_values:
            return v
        else:
            return 'gpt-3.5-turbo'

    @validator('OPENAI_TRANSCRIPTION_MODEL', pre=True)
    def validate_openai_transcription_model(cls, v):
        valid_value = 'whisper-1'
        if str(v).strip() == valid_value:
            return v
        else:
            raise ValueError(
                f"Invalid value for OPENAI_TRANSCRIPTION_MODEL, expected {valid_value}")


def environment() -> dict:
    return EnvModel(**os.environ).dict()


__all__ = ["environment"]
