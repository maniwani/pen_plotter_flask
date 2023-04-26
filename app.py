from functools import wraps
import mimetypes
import secrets

from flask import Flask, render_template, request
from flask_login import LoginManager, current_user
from flask_socketio import SocketIO, disconnect, emit, join_room, leave_room

from models import User
from oauth import oauth, user


def authenticated_only(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        if not current_user.is_authenticated:
            disconnect()
        else:
            return f(*args, **kwargs)

    return wrapped


# Windows registry can get this messed up, so overriding here
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

# construct app
app = Flask(__name__)
app.config["SECRET_KEY"] = secrets.token_urlsafe(16)
app.register_blueprint(user)

oauth.init_app(app)

login_manager = LoginManager()
login_manager.login_view = "login"
login_manager.init_app(app)

socket = SocketIO()
socket.init_app(app)


@login_manager.user_loader
def load_user(id):
    return User(id)


@app.route("/")
def index():
    return render_template("index.html")


@socket.on("connect")
def on_connect():
    print("Client connected.")


@socket.on("disconnect")
def on_disconnect():
    print("Client disconnected.")


@socket.on("join")
def on_join(data):
    room = data["room"]
    print(f"Client joined room: {room}.")
    join_room(room)


@socket.on("leave")
def on_leave(data):
    room = data["room"]
    print(f"Client left room: {room}.")
    leave_room(room)


@socket.on("plot")
def handle_plot_requests(data):
    if current_user.is_authenticated:
        # forward message from guests to plotter
        print("Received plot request.")
        emit("plot", data, to="plotter")


@socket.on("notify")
def handle_notifications(data):
    # forward message from plotter to guests
    print("Received plot status notification.")
    emit("notify", data, to="guests")


if __name__ == "__main__":
    socket.run(app)
