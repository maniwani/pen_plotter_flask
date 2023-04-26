import pathlib
from dotenv import load_dotenv

# load environment variables
basedir = pathlib.Path(__file__).parent.resolve()
load_dotenv(f"{basedir}/.env")
