"""Shared by the CLI tools: load backend/.env (no-op when already in the process env) and expose the demo/test credentials.
Secrets are never hardcoded in source — see DEMO_PASSWORD / TEST_PASSWORD in backend/.env."""
import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
DEMO_PASSWORD = os.environ["DEMO_PASSWORD"]
TEST_PASSWORD = os.environ.get("TEST_PASSWORD", DEMO_PASSWORD)
