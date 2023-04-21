import mimetypes
import secrets
from urllib.parse import quote_plus

from flask import (
    Flask,
    render_template,
)
from flask_login import (
    LoginManager,
)
from flask_sock import Sock

from models import User
from oauth import oauth, user

# Windows registry can get this messed up, so overriding here
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

# construct app
app = Flask(__name__)
app.config["SECRET_KEY"] = secrets.token_urlsafe(16)
# app.config["SERVER_NAME"] = 'localhost:5000'
app.register_blueprint(user)

oauth.init_app(app)

login_manager = LoginManager()
login_manager.login_view = "login"
login_manager.init_app(app)


@login_manager.user_loader
def load_user(id):
    return User(id)


websocket = Sock()
websocket.init_app(app)


@app.route("/")
def index():
    return render_template("index.html")


@websocket.route("/")
def handle_websocket(ws):
    while True:
        try:
            b = ws.receive()
            print(bytes.decode(b, "utf-8"))
            # send to appropriate plotter if connected
        except:
            ws.close()
