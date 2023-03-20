import mimetypes

from flask import Flask
from flask import render_template
from flask_sock import Sock

from pyaxidraw import axidraw

# from svgelements import SVG

# Windows registry can get this messed up, so overriding here
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

app = Flask(__name__)
app.config["SECRET_KEY"] = "replace this"
sock = Sock(app)


@app.route("/")
def home():
    return render_template("index.html")


@sock.route("/ws")
def handle_websocket(ws):
    while True:
        try:
            b = ws.receive()
            message = bytes.decode(b, "utf-8")
            # print(message)
            plot(message)
        except:
            ws.close()


def plot(svgString: str):
    # svg: SVG = SVG.parse(StringIO(svgString))

    # connect to plotter
    ad = axidraw.AxiDraw()

    # plot the svg
    ad.plot_setup(svgString)
    ad.options.auto_rotate = False
    ad.plot_run()

    # disable the motors
    ad.plot_setup()
    ad.options.mode = "manual"
    ad.options.manual_cmd = "disable_xy"
    ad.plot_run()
