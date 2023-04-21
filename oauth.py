from functools import wraps
from os import environ
import uuid
from urllib.parse import quote_plus

from authlib.integrations.flask_client import OAuth
from flask import (
    Blueprint,
    abort,
    flash,
    redirect,
    render_template,
    url_for,
    session,
)
from flask_login import (
    login_required,
    login_user,
    logout_user,
    current_user,
)

from models import User

DISCORD_API_BASE_URL = "https://discord.com/api/"
DISCORD_API_AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
DISCORD_API_ACCESS_TOKEN_URL = "https://discord.com/api/oauth2/token"
DISCORD_API_REVOKE_TOKEN_URL = "https://discord.com/api/oauth2/token/revoke"

DISCORD_CLIENT_ID = environ.get("DISCORD_CLIENT_ID")
DISCORD_CLIENT_SECRET = environ.get("DISCORD_CLIENT_SECRET")
DISCORD_CLIENT_OAUTH2_SCOPES = "identify guilds.members.read"

STAFF_SERVER_ID = "864267081255616542"
STAFF_SERVER_STAFF_ROLE_ID = "864276628237713459"
GUEST_SERVER_ID = "928508062623473695"
GUEST_SERVER_GUEST_ROLE_ID = "1039009934295191642"

oauth = OAuth()
oauth.register(
    name="discord",
    client_id=DISCORD_CLIENT_ID,
    client_secret=DISCORD_CLIENT_SECRET,
    authorize_url=DISCORD_API_AUTHORIZE_URL,
    authorize_params={"prompt": "consent"},
    access_token_url=DISCORD_API_ACCESS_TOKEN_URL,
    access_token_params=None,
    api_base_url=DISCORD_API_BASE_URL,
    client_kwargs={
        "scope": DISCORD_CLIENT_OAUTH2_SCOPES,
    },
)

user = Blueprint("user", __name__)


@user.route("/login")
def login():
    return render_template("login.html")


@user.route("/login/discord", methods=["POST"])
def login_discord():
    if current_user.is_authenticated:
        return redirect("/")

    redirect_url = url_for(".authorize_discord", _external=True)
    return oauth.discord.authorize_redirect(redirect_url)


@user.route("/authorize/discord")
def authorize_discord():
    if current_user.is_authenticated:
        return redirect("/")

    try:
        oauth.discord.authorize_access_token()
        if is_staff() or is_guest():
            user = User(id=uuid.uuid4())
            login_user(user)
            user_info = oauth.discord.get(quote_plus("users/@me"))
            session["_discord_user"] = user_info.json()
            flash("Success!")
        else:
            flash("Your account does not have permission to login.")
    except:
        flash("There was an error logging in.")

    return redirect("/")


@user.route("/logout")
@login_required
def logout():
    logout_user()
    session.pop("_discord_user")
    return redirect("/")


def is_staff():
    return has_server_role(STAFF_SERVER_ID, STAFF_SERVER_STAFF_ROLE_ID)


def is_guest():
    return has_server_role(GUEST_SERVER_ID, GUEST_SERVER_GUEST_ROLE_ID)


def has_server_role(server_id, role_id):
    resp = oauth.discord.get(quote_plus(f"users/@me/guilds/{server_id}/member"))
    if resp.ok:
        member = resp.json()
        for role in member["roles"]:
            if role == role_id:
                return True
    return False


def role_required(f, role: str):
    @wraps(f)
    def wrap(*args, **kwargs):
        if current_user.role == role:
            return f(*args, **kwargs)
        else:
            flash("You do not have the required permissions to view this page.")
            return abort(403)

    return wrap


# def login_required(f):
#     @wraps(f)
#     def wrap(*args, **kwargs):
#         if "session_id" in session:
#             return f(*args, **kwargs)
#         else:
#             flash("Please login.")
#             return redirect(url_for("login"))
#     return wrap
