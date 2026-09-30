import os
from typing import List, Dict
from pydantic import BaseModel, Field
from dotenv import load_dotenv
load_dotenv(".env")
from openai import OpenAI

class TestSchema(BaseModel):
    platform_claims: dict[str, List[str]] = Field(default_factory=dict, description="Claims")

client = OpenAI()
try:
    resp = client.responses.parse(
        model="gpt-5.4-mini",
        instructions="Return some claims",
        input="test",
        text_format=TestSchema,
        max_output_tokens=100
    )
    print(resp.output_parsed)
except Exception as e:
    print(f"Exception class: {e.__class__.__name__}")
    print(f"Exception message: {str(e)}")
    print(f"Exception repr: {repr(e)}")
