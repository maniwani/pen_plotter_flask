import { registerModalListeners } from "../js/modal.js"

function ease(x) {
    return 1 - Math.sqrt(1 - x * x)
}

function format(x) {
    return x.toFixed(3)
}

function remap(value, inMin, inMax, outMin, outMax) {
    return outMin + ((value - inMin) * (outMax - outMin)) / (inMax - inMin)
}

function resizeCanvasToDisplaySize(canvas) {
    let displayWidth = canvas.clientWidth
    let displayHeight = canvas.clientHeight
    let resize = canvas.width !== displayWidth || canvas.height !== displayHeight

    if (resize) {
        canvas.width = displayWidth
        canvas.height = displayHeight
    }

    return resize
}

function download(content, mimeType, filename) {
    const link = document.createElement("a")
    const file = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(file)
    link.setAttribute("href", url)
    link.setAttribute("download", filename)
    link.click()
    URL.revokeObjectURL(url);
    link.remove();
}

function xmlDecode(input) {
    const parser = new DOMParser()
    var doc = parser.parseFromString(input, "image/svg+xml")
    return doc.documentElement.textContent
}

function htmlDecode(input) {
    const parser = new DOMParser()
    var doc = parser.parseFromString(input, "text/html")
    return doc.documentElement.textContent
}

export class Vec2 {
    constructor(x, y) {
        this.x = x
        this.y = y
    }

    static ZERO = new Vec2(0, 0)
    static X = new Vec2(1, 0)
    static Y = new Vec2(0, 1)

    set(point) {
        this.x = point.x
        this.y = point.y
    }

    equals(rhs) {
        return this.x === rhs.x && this.y === rhs.y
    }

    add(rhs) {
        return new Vec2(this.x + rhs.x, this.y + rhs.y)
    }

    sub(rhs) {
        return new Vec2(this.x - rhs.x, this.y - rhs.y)
    }

    mul(rhs) {
        return new Vec2(this.x * rhs, this.y * rhs)
    }

    div(rhs) {
        return new Vec2(this.x / rhs, this.y / rhs)
    }

    dot(rhs) {
        return this.x * rhs.x + this.y * rhs.y
    }

    perpDot(rhs) {
        return this.x * rhs.y - this.y * rhs.x
    }

    transform(mat) {
        let scaleX = mat.a
        let scaleY = mat.d
        let shearX = mat.b
        let shearY = mat.c
        let dx = mat.e
        let dy = mat.f

        let x = scaleX * this.x + shearY * this.y + dx
        let y = scaleY * this.y + shearX * this.x + dy
        return new Vec2(x, y)
    }

    length() {
        return Math.sqrt(this.lengthSquared())
    }

    lengthRecip() {
        return 1.0 / this.length()
    }

    lengthSquared() {
        return this.dot(this)
    }

    distance(rhs) {
        let d = this.sub(rhs)
        return d.length()
    }

    distanceSquared(rhs) {
        let d = this.sub(rhs)
        return d.lengthSquared()
    }

    normalize() {
        return this.mul(this.lengthRecip())
    }

    isNormalized() {
        return Math.abs(this.lengthSquared() - 1.0) <= 1e-4
    }

    projectOnto(rhs) {
        return rhs.mul(this.dot(rhs) / rhs.dot(rhs))
    }

    projectOntoNormalized(rhs) {
        return rhs.mul(this.dot(rhs))
    }

    rejectFrom(rhs) {
        return this.sub(this.projectOnto(rhs))
    }

    rejectFromNormalized(rhs) {
        return this.sub(this.projectOntoNormalized(rhs))
    }
}

class NoSmoothing {
    constructor() {
        this._value = Vec2.ZERO
    }

    push(value) {
        this._value = value
    }

    value() {
        return new Vec2(this._value.x, this._value.y)
    }

    clear() {
        this._value = Vec2.ZERO
    }
}

// A simple moving average. Samples are given equal weight.
class SimpleSmoothing {
    constructor(capacity) {
        this.capacity = capacity
        this.clear()
    }

    push(value) {
        let i = this.count % this.capacity
        this.count += 1
        if (this.count <= this.capacity) {
            this.samples.push(value)
            this.mean.x += (value.x - this.mean.x) / this.count
            this.mean.y += (value.y - this.mean.y) / this.count
        } else {
            let removed = this.samples[i]
            this.samples[i] = value
            this.mean.x += (value.x - removed.x) / this.capacity
            this.mean.y += (value.y - removed.y) / this.capacity
        }
    }

    value() {
        return new Vec2(this.mean.x, this.mean.y)
    }

    clear() {
        this.mean = Vec2.ZERO
        this.samples = []
        this.count = 0
    }
}

// An exponential smoothing filter. More recent samples are given higher weight.
class ExpSmoothing {
    constructor(alpha) {
        this.alpha = Math.min(Math.max(alpha, 0.0), 1.0)
        this.clear()
    }

    push(value) {
        this.count += 1
        if (this.count == 1) {
            this.smoothed = value
        } else {
            this.smoothed.x =
                this.smoothed.x * (1.0 - this.alpha) + value.x * this.alpha
            this.smoothed.y =
                this.smoothed.y * (1.0 - this.alpha) + value.y * this.alpha
        }
    }

    value() {
        return new Vec2(this.smoothed.x, this.smoothed.y)
    }

    clear() {
        this.smoothed = Vec2.ZERO
        this.count = 0
    }
}

// Krita uses a weighted average for smoothing. Points are inversely weighed based on "distance
// traveled up to latest point", which makes the "window size" change dynamically in nice ways.
//
// The weight function is the PDF of the normal distribution, mostly because (1) it has
// the shape of a bell curve (smooth decrease in weight) and (2) is easy to calculate.
class KritaSmoothing {
    constructor(sigma) {
        this.sigma = sigma
        this.clear()
    }

    push(value) {
        let maxWeight = 1.0 / (Math.sqrt(2 * Math.PI) * this.sigma)
        let sigma3 = 3.0 * this.sigma
        let sigmaSq = this.sigma * this.sigma
        let distance = 0
        let distanceSq = 0
        let weight = maxWeight
        let weightSum = maxWeight
        this.mean.x = maxWeight * value.x
        this.mean.y = maxWeight * value.y

        if (this.samples.length > 0) {
            this.deltas.push(value.distance(this.samples[this.samples.length - 1]))
        }

        this.samples.push(value)

        for (let i = this.deltas.length - 1; i >= 0; i -= 1) {
            distance += this.deltas[i]
            if (distance > sigma3) {
                break
            }

            distanceSq = distance * distance
            weight = maxWeight * Math.exp((-0.5 * distanceSq) / sigmaSq)
            weightSum += weight
            this.mean.x += weight * this.samples[i].x
            this.mean.y += weight * this.samples[i].y
        }

        this.mean.x /= weightSum
        this.mean.y /= weightSum
    }

    value() {
        return this.mean
    }

    clear() {
        this.mean = Vec2.ZERO
        this.samples = []
        this.deltas = []
    }
}

const RADIUS_DEFAULT = 2.5

class Brush {
    constructor(options = {}) {
        const startingPoint = options.startingPoint || {
            x: 0,
            y: 0
        }
        this.deadzoneRadius = options.deadzoneRadius || RADIUS_DEFAULT
        this.deadzone =
            options.deadzoneEnabled === undefined ? false : options.deadzoneEnabled

        this.smoothing =
            options.smoothingFunction === undefined
                ? new NoSmoothing()
                : options.smoothingFunction

        this.pointer = new Vec2(startingPoint.x, startingPoint.y)
        this.brush = new Vec2(startingPoint.x, startingPoint.y)
    }

    /** Enables the deadzone. */
    enableDeadzone() {
        this.deadzone = true
    }

    /** Disables the deadzone. */
    disableDeadzone() {
        this.deadzone = false
    }

    /** Returns `true` if the deadzone is enabled. */
    deadzoneEnabled() {
        return this.deadzone
    }

    /** Return the current deadzone radius (in pixels). */
    getDeadzoneRadius() {
        return this.deadzoneRadius
    }

    /** Updates the deadzone radius. */
    setDeadzoneRadius(pixels) {
        this.deadzoneRadius = pixels
    }

    /** Returns the brush position. */
    getBrushPosition() {
        return new Vec2(this.brush.x, this.brush.y)
    }

    /** Return the pointer position. */
    getPointerPosition() {
        return new Vec2(this.pointer.x, this.pointer.y)
    }

    /** Updates the pointer and calculates the new brush position. */
    update(pointer, options = {}) {
        if (this.pointer.equals(pointer) && !options.snap && !options.lag) {
            return false
        }

        if (options.snap) {
            this.brush = pointer
            this.smoothing.clear()
            return true
        }

        // smoof
        this.smoothing.push(pointer)
        this.pointer = this.smoothing.value()

        // deadzone
        if (this.deadzone) {
            let diff = this.pointer.sub(this.brush)
            const outside = diff.length() - this.deadzoneRadius > 1e-2
            const lag =
                options.lag && options.lag > 0.0 && options.lag < 1.0
                    ? options.lag
                    : undefined

            if (outside) {
                if (lag) {
                    let dampened = diff.mul(ease(1.0 - lag))
                    this.brush = this.brush.add(dampened)
                } else {
                    this.brush = this.brush.add(diff)
                }
                return true
            }
        } else {
            this.brush = this.smoothing.value()
            return true
        }

        return false
    }
}

class Point {
    constructor(position) {
        this.x = position.x
        this.y = position.y
    }

    draw(ctx) {
        ctx.beginPath()
        ctx.moveTo(this.x, this.y)
        ctx.lineTo(this.x, this.y)
        ctx.stroke()
    }
}

class Line {
    constructor(start, end) {
        this.start = start
        this.end = end
    }

    draw(ctx) {
        ctx.beginPath()
        ctx.moveTo(this.start.x, this.start.y)
        ctx.lineTo(this.end.x, this.end.y)
        ctx.stroke()
    }
}

class CatmullRomCurve {
    constructor(p0, p1, p2, p3, alpha) {
        this.p0 = p0
        this.p1 = p1
        this.p2 = p2
        this.p3 = p3

        this.alpha = alpha

        let t01 = Math.pow(p0.distance(p1), alpha)
        let t12 = Math.pow(p1.distance(p2), alpha)
        let t23 = Math.pow(p2.distance(p3), alpha)

        let m1x =
            p2.x - p1.x + t12 * ((p1.x - p0.x) / t01 - (p2.x - p0.x) / (t01 + t12))
        let m1y =
            p2.y - p1.y + t12 * ((p1.y - p0.y) / t01 - (p2.y - p0.y) / (t01 + t12))
        let m1 = new Vec2(m1x, m1y)

        let m2x =
            p2.x - p1.x + t12 * ((p3.x - p2.x) / t23 - (p3.x - p1.x) / (t12 + t23))
        let m2y =
            p2.y - p1.y + t12 * ((p3.y - p2.y) / t23 - (p3.y - p1.y) / (t12 + t23))
        let m2 = new Vec2(m2x, m2y)

        this.a = p1
            .sub(p2)
            .mul(2.0)
            .add(m1)
            .add(m2)
        this.b = p2
            .sub(p1)
            .mul(3.0)
            .sub(m1)
            .sub(m1)
            .sub(m2)
        this.c = m1
        this.d = p1
    }

    interpolate(percent) {
        let a = this.a
        let b = this.b
        let c = this.c
        let d = this.d
        return a
            .mul(percent)
            .add(b)
            .mul(percent)
            .add(c)
            .mul(percent)
            .add(d)
    }

    toCubicBezier() {
        let p0 = this.p0
        let p1 = this.p1
        let p2 = this.p2
        let p3 = this.p3
        let d = 6.0 * this.alpha

        let x = p1.x + (p2.x - p0.x) / d
        let y = p1.y + (p2.y - p0.y) / d
        let pn1 = new Vec2(x, y)

        x = p2.x - (p3.x - p1.x) / d
        y = p2.y - (p3.y - p1.y) / d
        let pn2 = new Vec2(x, y)

        return new CubicBezierCurve(p1, pn1, pn2, p2)
    }
}

class CubicBezierCurve {
    constructor(p0, p1, p2, p3) {
        this.p0 = p0
        this.p1 = p1
        this.p2 = p2
        this.p3 = p3

        this.a = p1
            .sub(p2)
            .mul(3.0)
            .add(p3.sub(p0))
        this.b = p0.sub(p1.add(p2).mul(2.0)).mul(3.0)
        this.c = p1.sub(p0).mul(3.0)
        this.d = p0
    }

    interpolate(percent) {
        let a = this.a
        let b = this.b
        let c = this.c
        let d = this.d
        return a
            .mul(percent)
            .add(b)
            .mul(percent)
            .add(c)
            .mul(percent)
            .add(d)
    }

    toCatmullRom() {
        let p0 = this.p0
        let p1 = this.p1
        let p2 = this.p2
        let p3 = this.p3

        let x = p3.x + 6.0 * (p0.x - p1.x)
        let y = p3.y + 6.0 * (p0.y - p1.y)
        let cr0 = new Vec2(x, y)

        x = p0.x + 6.0 * (p3.x - p2.x)
        y = p0.y + 6.0 * (p3.y - p2.y)
        let cr3 = new Vec2(x, y)

        return new CatmullRomCurve(cr0, p0, p3, cr3, 1.0)
    }

    draw(ctx) {
        ctx.beginPath()
        ctx.moveTo(this.p0.x, this.p0.y)
        ctx.bezierCurveTo(
            this.p1.x,
            this.p1.y,
            this.p2.x,
            this.p2.y,
            this.p3.x,
            this.p3.y
        )
        ctx.stroke()
    }
}

class BrushStroke {
    constructor() {
        this.positions = []
        this.spline = []
        this.simplePositions = []
        this.simpleSpline = []
    }

    addPoint(point) {
        this.positions.push(point)
    }

    draw(ctx) {
        let positions = this.positions
        let n = positions.length
        if (n == 1) {
            ctx.beginPath()
            ctx.moveTo(positions[0].x, positions[0].y)
            ctx.lineTo(positions[0].x, positions[0].y)
            ctx.stroke()
        } else if (n == 2) {
            ctx.beginPath()
            ctx.moveTo(positions[0].x, positions[0].y)
            ctx.lineTo(positions[1].x, positions[1].y)
            ctx.stroke()
        } else {
            ctx.beginPath()
            for (let i = 1; i < n; i++) {
                let p1 = positions[i - 1]
                let p2 = positions[i]
                let p3 = i + 1 < n ? positions[i + 1] : p2
                let p0 = i - 2 >= 0 ? positions[i - 2] : p1
                // draw catmull-rom curve then convert curve into cubic bezier
                let bez = new CatmullRomCurve(p0, p1, p2, p3, 1.0).toCubicBezier()

                ctx.moveTo(bez.p0.x, bez.p0.y)
                ctx.bezierCurveTo(
                    bez.p1.x,
                    bez.p1.y,
                    bez.p2.x,
                    bez.p2.y,
                    bez.p3.x,
                    bez.p3.y
                )
            }
            ctx.stroke()
        }
    }

    finish() {
        let positions = this.positions
        let n = positions.length
        if (n == 1) {
            let point = new Point(positions[0])
            this.spline.push(point)
        } else if (n == 2) {
            let line = new Line(positions[0], positions[1])
            this.spline.push(line)
        } else {
            for (let i = 1; i < n; i++) {
                let p1 = positions[i - 1]
                let p2 = positions[i]
                let p3 = i + 1 < n ? positions[i + 1] : p2
                let p0 = i - 2 >= 0 ? positions[i - 2] : p1

                // draw catmull-rom curve then convert curve into cubic bezier
                let bez = new CatmullRomCurve(p0, p1, p2, p3, 1.0).toCubicBezier()
                this.spline.push(bez)
            }
        }

        let keep = simplifyRDP(positions, 0.5, false)
        for (let i = 0; i < keep.length; i += 1) {
            if (keep[i]) {
                let p = positions[i]
                this.simplePositions.push(p)
            }
        }

        let simplePositions = this.simplePositions
        n = this.simplePositions.length
        if (n == 1) {
            let point = new Point(simplePositions[0])
            this.simpleSpline.push(point)
        } else if (n == 2) {
            let line = new Line(simplePositions[0], simplePositions[1])
            this.simpleSpline.push(line)
        } else {
            for (let i = 1; i < n; i++) {
                let p1 = simplePositions[i - 1]
                let p2 = simplePositions[i]
                let p3 = i + 1 < n ? simplePositions[i + 1] : p2
                let p0 = i - 2 >= 0 ? simplePositions[i - 2] : p1

                // draw catmull-rom curve then convert curve into cubic bezier
                let bez = new CatmullRomCurve(p0, p1, p2, p3, 1.0).toCubicBezier()
                this.simpleSpline.push(bez)
            }
        }
    }

    getSVGPath(inWidth, inHeight, outWidth, outHeight) {
        let subPaths = []
        for (let s of this.simpleSpline.slice(0, 1)) {
            if (s instanceof Point) {
                let x = format(remap(s.x, 0, inWidth, 0, outWidth))
                let y = format(remap(s.y, 0, inHeight, 0, outHeight))
                subPaths.push(`M${x},${y}L${x},${y}`)
            } else if (s instanceof Line) {
                let x0 = format(remap(s.start.x, 0, inWidth, 0, outWidth))
                let y0 = format(remap(s.start.y, 0, inHeight, 0, outHeight))
                let x1 = format(remap(s.end.x, 0, inWidth, 0, outWidth))
                let y1 = format(remap(s.end.y, 0, inHeight, 0, outHeight))
                subPaths.push(`M${x0},${y0}L${x1},${y1}`)
            } else if (s instanceof CubicBezierCurve) {
                let x0 = format(remap(s.p0.x, 0, inWidth, 0, outWidth))
                let y0 = format(remap(s.p0.y, 0, inHeight, 0, outHeight))
                let x1 = format(remap(s.p1.x, 0, inWidth, 0, outWidth))
                let y1 = format(remap(s.p1.y, 0, inHeight, 0, outHeight))
                let x2 = format(remap(s.p2.x, 0, inWidth, 0, outWidth))
                let y2 = format(remap(s.p2.y, 0, inHeight, 0, outHeight))
                let x3 = format(remap(s.p3.x, 0, inWidth, 0, outWidth))
                let y3 = format(remap(s.p3.y, 0, inHeight, 0, outHeight))
                subPaths.push(`M${x0},${y0}C${x1},${y1} ${x2},${y2} ${x3},${y3}`)
            }
        }

        for (let s of this.simpleSpline.slice(1)) {
            if (s instanceof Point) {
                let x = format(remap(s.x, 0, inWidth, 0, outWidth))
                let y = format(remap(s.y, 0, inHeight, 0, outHeight))
                subPaths.push(`L${x},${y}`)
            } else if (s instanceof Line) {
                let x1 = format(remap(s.end.x, 0, inWidth, 0, outWidth))
                let y1 = format(remap(s.end.y, 0, inHeight, 0, outHeight))
                subPaths.push(`L${x1},${y1}`)
            } else if (s instanceof CubicBezierCurve) {
                let x1 = format(remap(s.p1.x, 0, inWidth, 0, outWidth))
                let y1 = format(remap(s.p1.y, 0, inHeight, 0, outHeight))
                let x2 = format(remap(s.p2.x, 0, inWidth, 0, outWidth))
                let y2 = format(remap(s.p2.y, 0, inHeight, 0, outHeight))
                let x3 = format(remap(s.p3.x, 0, inWidth, 0, outWidth))
                let y3 = format(remap(s.p3.y, 0, inHeight, 0, outHeight))
                subPaths.push(`C${x1},${y1} ${x2},${y2} ${x3},${y3}`)
            }
        }

        let subPathString = subPaths.join("")

        let path = document.createElementNS("http://www.w3.org/2000/svg", "path")
        path.setAttribute("d", subPathString)
        // path.setAttribute("styte", "fill:none;fill-rule:nonzero;stroke:#000;stroke-width:5px;");
        path.style.fill = "none"
        path.style.fillRule = "nonzero"
        path.style.stroke = "black"
        path.style.strokeWidth = `${outWidth / 100}`

        return path
    }
}

class BrushStrokeStore {
    constructor() {
        this.undoStrokes = []
        this.redoStrokes = []
    }

    length() {
        return this.undoStrokes.length
    }

    addStroke(stroke) {
        // adding new points clears the redo buffer
        this.redoStrokes = []
        this.undoStrokes.push(stroke)
    }

    undoStroke() {
        if (this.undoStrokes.length > 0) {
            let stroke = this.undoStrokes.pop()
            this.redoStrokes.push(stroke)
            return true
        }

        return false
    }

    redoStroke() {
        if (this.redoStrokes.length > 0) {
            let stroke = this.redoStrokes.pop()
            this.undoStrokes.push(stroke)
            return true
        }

        return false
    }

    getSVG(inWidth, inHeight, outWidth, outHeight) {
        let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
        svg.setAttribute("width", `${outWidth}in`)
        svg.setAttribute("height", `${outHeight}in`)
        svg.setAttribute("viewBox", `0 0 ${outWidth} ${outHeight}`)
        svg.setAttribute("version", "1.1")
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
        svg.setAttributeNS(
            "http://www.w3.org/2000/xmlns/",
            "xmlns:xlink",
            "http://www.w3.org/1999/xlink"
        )
        // svg.setAttribute("style", "fill-rule:evenodd;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;");
        svg.style.fillRule = "evenodd"
        svg.style.clipRule = "evenodd"
        svg.style.strokeLinecap = "round"
        svg.style.strokeLinejoin = "round"

        document.body.appendChild(svg)
        for (let stroke of this.undoStrokes) {
            let path = stroke.getSVGPath(inWidth, inHeight, outWidth, outHeight)
            svg.appendChild(path)
        }

        return svg
    }
}

// A and B paper sizes have the same aspect ratio.
const ASPECT_RATIO = Math.SQRT2
const MIN_ZOOM = 0.1
const MAX_ZOOM = 10.0
const SCROLL_SENSITIVITY = 0.0005

var Tool

    ; (function (Tool) {
        Tool[(Tool["Move"] = 0)] = "Move"
        Tool[(Tool["Rotate"] = 1)] = "Rotate"
        Tool[(Tool["Zoom"] = 2)] = "Zoom"
        Tool[(Tool["Draw"] = 3)] = "Draw"
    })(Tool || (Tool = {}))

class App {
    constructor() {
        // // B6 is 125mm x 176mm
        // // A4 is 210mm x 297mm
        // let test = document.createElement('canvas') as HTMLCanvasElement;
        // test.height = window.innerHeight;
        // test.width = window.innerHeight / ASPECT_RATIO;

        // // draw a black border around the canvas
        // test.style.borderWidth = "1px";
        // test.style.borderStyle = "solid";
        // test.style.borderColor = "black";

        // let ctx = test.getContext('2d')!;
        // ctx.strokeStyle = 'black';
        // // regular pen is 1mm
        // // decocolor fine pen is 1.25mm
        // // decocolor broad pen is 2mm
        // ctx.lineWidth = test.width * (2 / 125);
        // ctx.lineCap = 'round';
        // ctx.lineJoin = 'round';

        this.socket = io.connect();
        this.socket.on("connect", () => {
            this.socket.emit("join", { "room": "guests" })
        });

        let pane = document.getElementById("pane")
        let canvas = document.getElementById("canvas")
        let context = canvas.getContext("2d")

        // make canvas pixel buffer match its on-screen dimensions
        resizeCanvasToDisplaySize(canvas)

        context.strokeStyle = "black"
        context.lineWidth = canvas.width / 100
        context.lineCap = "round"
        context.lineJoin = "round"

        this.pane = pane
        this.canvas = canvas
        this.context = context
        this.transform = new DOMMatrix()
        this.background = new Image()

        this.tool = Tool.Draw
        this.toolActive = false
        this.toolStart = Vec2.ZERO

        this.brush = new Brush({ smoothingFunction: new KritaSmoothing(10) })
        this.stroke = new BrushStroke()
        this.strokes = new BrushStrokeStore()

        this.addEventListeners()
        registerModalListeners()

        window.requestAnimationFrame(() => this.redraw())
    }

    addEventListeners() {
        let canvas = this.canvas
        canvas.addEventListener("mousedown", this.toolDownEventHandler)
        canvas.addEventListener("mousemove", this.toolMoveEventHandler)
        canvas.addEventListener("mouseup", this.toolUpEventHandler)
        canvas.addEventListener("mouseout", this.cancelEventHandler)

        canvas.addEventListener("touchstart", this.toolDownEventHandler)
        canvas.addEventListener("touchmove", this.toolMoveEventHandler)
        canvas.addEventListener("touchend", this.toolUpEventHandler)
        canvas.addEventListener("touchcancel", this.cancelEventHandler)

        canvas.addEventListener("wheel", this.wheelEventHandler)

        // sidebar
        let drawButton = document.getElementById("draw")
        if (drawButton) {
            drawButton.addEventListener("click", () => this.changeTool(Tool.Draw))
            drawButton.addEventListener("click", () => {
                drawButton.blur()
            })
        }

        let blackButton = document.getElementById("set-color-black")
        if (blackButton) {
            blackButton.addEventListener("click", () => this.setCanvasPenColor("#000000"))
            blackButton.addEventListener("click", () => {
                blackButton.blur()
            })
        }

        let silverButton = document.getElementById("set-color-silver")
        if (silverButton) {
            silverButton.addEventListener("click", () => this.setCanvasPenColor("#bebcbf"))
            silverButton.addEventListener("click", () => {
                silverButton.blur()
            })
        }

        let goldButton = document.getElementById("set-color-gold")
        if (goldButton) {
            goldButton.addEventListener("click", () => this.setCanvasPenColor("#b89865"))
            goldButton.addEventListener("click", () => {
                goldButton.blur()
            })
        }

        let homeButton = document.getElementById("home")
        if (homeButton) {
            homeButton.addEventListener("click", this.homeEventHandler)
            homeButton.addEventListener("click", () => {
                homeButton.blur()
            })
        }

        let moveButton = document.getElementById("move")
        if (moveButton) {
            moveButton.addEventListener("click", () => this.changeTool(Tool.Move))
            moveButton.addEventListener("click", () => {
                moveButton.blur()
            })
        }

        let rotateButton = document.getElementById("rotate")
        if (rotateButton) {
            rotateButton.addEventListener("click", () => this.changeTool(Tool.Rotate))
            rotateButton.addEventListener("click", () => {
                rotateButton.blur()
            })
        }

        let zoomButton = document.getElementById("zoom")
        if (zoomButton) {
            zoomButton.addEventListener("click", () => this.changeTool(Tool.Zoom))
            zoomButton.addEventListener("click", () => {
                zoomButton.blur()
            })
        }

        // topbar
        let undoButton = document.getElementById("undo")
        if (undoButton) {
            undoButton.addEventListener("click", this.undoEventHandler)
            undoButton.addEventListener("click", () => {
                undoButton.blur()
            })
        }

        let redoButton = document.getElementById("redo")
        if (redoButton) {
            redoButton.addEventListener("click", this.redoEventHandler)
            redoButton.addEventListener("click", () => {
                redoButton.blur()
            })
        }

        let clearButton = document.getElementById("clear")
        if (clearButton) {
            clearButton.addEventListener("click", this.clearEventHandler)
            clearButton.addEventListener("click", () => {
                clearButton.blur()
            })
        }

        let downloadButton = document.getElementById("download")
        if (downloadButton) {
            downloadButton.addEventListener("click", this.downloadEventHandler)
        }

        let printModalButton = document.getElementById("print-dialog")
        if (printModalButton) {
            printModalButton.addEventListener("click", () => {
                redoButton.blur()
            })
        }

        let printConfirmButton = document.getElementById("print-confirm")
        if (printConfirmButton) {
            printConfirmButton.addEventListener("click", this.printEventHandler)
        }

        let backgroundUpload = document.getElementById("background-upload")
        let backgroundFileDrop = document.getElementById("background-file-drop")

        if (backgroundFileDrop && backgroundUpload) {
            backgroundUpload.addEventListener("change", (event) => {
                this.setCanvasBackground(event.target.files[0])
            })

            backgroundFileDrop.addEventListener("click", () => {
                backgroundUpload.click();
            })

            backgroundFileDrop.addEventListener("dragover", (event) => {
                event.stopPropagation();
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy"
            });

            backgroundFileDrop.addEventListener("drop", (event) => {
                event.stopPropagation()
                event.preventDefault()
                let files = event.dataTransfer.files;
                if (files && files.length) {
                    this.setCanvasBackground(files[0])
                }
            });
        }

        let backgroundRemove = document.getElementById("background-remove")
        if (backgroundRemove) {
            backgroundRemove.addEventListener("click", () => {
                this.clearCanvasBackground()
            })
        }
    }

    setCanvasBackground(file) {
        if (!file || !file.type || !file.type.match("image.*")) {
            return;
        }

        const reader = new FileReader();
        reader.addEventListener("load", () => {
            this.background.src = reader.result;
        })

        reader.readAsDataURL(file);
    }

    clearCanvasBackground() {
        this.background.src = ""
    }

    setCanvasPenColor(color) {
        this.context.strokeStyle = color;
    }

    clearCanvas() {
        // var p1 = this.screenToCanvas(this.context, new Vec2(0, 0));
        // var p2 = this.screenToCanvas(this.context, new Vec2(this.canvas.width, this.canvas.height));
        // this.context.clearRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)

        // alternative:
        // ctx.save();
        // ctx.setTransform(1, 0, 0, 1, 0, 0);
        // ctx.clearRect(0, 0, canvas.width, canvas.height);
        // ctx.restore();
    }

    clear() {
        this.brush = new Brush({ smoothingFunction: new KritaSmoothing(10) })
        this.stroke = new BrushStroke()
        this.strokes = new BrushStrokeStore()
    }

    redraw() {
        this.syncTransform()
        this.clearCanvas()

        if (this.background.src) {
            drawImageProp(this.context, this.background)
            // this.context.drawImage(this.background, 0, 0, this.canvas.width, this.canvas.height)
        }

        for (let stroke of this.strokes.undoStrokes) {
            stroke.draw(this.context)
        }
        this.stroke.draw(this.context)
        window.requestAnimationFrame(() => this.redraw())
    }

    finish() {
        this.stroke.finish()
        this.strokes.addStroke(this.stroke)
        this.stroke = new BrushStroke()
    }

    clearEventHandler = () => {
        this.clearCanvas()
        this.clear()
    }

    undoEventHandler = () => {
        this.strokes.undoStroke()
    }

    redoEventHandler = () => {
        this.strokes.redoStroke()
    }

    printEventHandler = () => {
        if (!this.strokes.length()) {
            return;
        }

        let svg = this.strokes.getSVG(
            this.canvas.width,
            this.canvas.height,
            4.9,
            6.9
        )

        let serializer = new XMLSerializer()
        let content = serializer.serializeToString(svg)
        this.socket.emit("plot", { "svg": content })
    }

    downloadEventHandler = () => {
        if (!this.strokes.length()) {
            return;
        }

        let svg = this.strokes.getSVG(
            this.canvas.width,
            this.canvas.height,
            4.9,
            6.9
        )

        let serializer = new XMLSerializer()
        let content = serializer.serializeToString(svg)

        let date = new Date();
        let filename = `autograph_${date.toISOString()}.svg`.replace(/:/g, "_")
        download(content, "image/svg+xml;charset=utf-8", filename)
    }

    changeTool(tool) {
        this.tool = tool
    }

    syncTransform() {
        this.canvas.style.transform = this.transform.toString()
        //resizeCanvasToDisplaySize(this.canvas)
    }

    homeEventHandler = () => {
        this.transform = new DOMMatrix()
    }

    getPointFromEvent(e) {
        let mouseX = e.changedTouches ? e.changedTouches[0].pageX : e.pageX
        let mouseY = e.changedTouches ? e.changedTouches[0].pageY : e.pageY
        let x = mouseX - this.canvas.offsetLeft
        let y = mouseY - this.canvas.offsetTop

        // let mouseX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX
        // let mouseY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY
        // let bounds = this.canvas.getBoundingClientRect()
        // let x = mouseX - bounds.left
        // let y = mouseY - bounds.top

        let screenPoint = new Vec2(x, y)
        return this.screenToCanvas(screenPoint)
    }

    toolDownEventHandler = e => {
        e.preventDefault()

        let point = this.getPointFromEvent(e)
        switch (this.tool) {
            case Tool.Move:
                this.toolStart = point
                break
            case Tool.Rotate:
                this.toolStart = point
                break
            case Tool.Zoom:
                this.toolStart = point
                break
            case Tool.Draw:
                if (this.brush.update(point, { snap: true })) {
                    point = this.brush.getBrushPosition()
                    this.stroke.addPoint(point)
                }
                break
        }

        this.toolActive = true
    }

    toolMoveEventHandler = e => {
        if (!this.toolActive) {
            return
        }

        e.preventDefault()

        let point = this.getPointFromEvent(e)
        switch (this.tool) {
            case Tool.Move:
                this.transform.translateSelf(
                    point.x - this.toolStart.x,
                    point.y - this.toolStart.y
                )
                break
            case Tool.Rotate:
                // TODO
                break
            case Tool.Zoom:
                // TODO
                break
            case Tool.Draw:
                if (this.brush.update(point, { snap: false })) {
                    point = this.brush.getBrushPosition()
                    this.stroke.addPoint(point)
                }
                break
        }
    }

    toolUpEventHandler = () => {
        if (!this.toolActive) {
            return
        }

        switch (this.tool) {
            case Tool.Move:
                this.toolStart = Vec2.ZERO
                break
            case Tool.Rotate:
                this.toolStart = Vec2.ZERO
                break
            case Tool.Zoom:
                this.toolStart = Vec2.ZERO
                break
            case Tool.Draw:
                this.finish()
                break
        }

        this.toolActive = false
    }

    cancelEventHandler = () => {
        if (!this.toolActive) {
            return
        }

        switch (this.tool) {
            case Tool.Move:
                this.toolStart = Vec2.ZERO
                break
            case Tool.Rotate:
                this.toolStart = Vec2.ZERO
                break
            case Tool.Zoom:
                this.toolStart = Vec2.ZERO
                break
            case Tool.Draw:
                this.finish()
                break
        }

        this.toolActive = false
    }

    wheelEventHandler = e => {
        e.preventDefault()

        switch (this.tool) {
            case Tool.Move:
                break
            case Tool.Rotate:
                // TODO
                break
            case Tool.Zoom:
                // TODO
                break
            case Tool.Draw:
                break
        }
    }

    // If you have a point (x, y) in screen-space, and you want to know where it will be drawn
    // on the object, you apply the inverse of the transformation.
    screenToCanvas(point) {
        // let transform = ctx.getTransform();
        let transform = this.transform
        return point.transform(transform.inverse())
    }

    // If you have a point (x,y) in object-space, and you want to know where it will be drawn
    // on the screen, you apply the transformation to it.
    canvasToScreen(point) {
        // let transform = ctx.getTransform();
        let transform = this.transform
        return point.transform(transform)
    }
}

function perpendicularDistance(p, a, b) {
    let ab = b.sub(a)
    return Math.abs(p.perpDot(ab) + b.perpDot(a)) / ab.length()
}

function simplifyRDP(positions, threshold, relative) {
    let n = positions.length
    let keep = new Array(n).fill(true)
    let stack = new Array([0, n - 1])

    while (stack.length > 0) {
        let [start, end] = stack.pop()

        let maxDistance = 0.0
        let maxDistanceIndex = start

        for (let i = start + 1; i < end; i += 1) {
            if (keep[i]) {
                let distance = perpendicularDistance(
                    positions[i],
                    positions[start],
                    positions[end]
                )
                if (distance > maxDistance) {
                    maxDistance = distance
                    maxDistanceIndex = i
                }
            }
        }

        let thresh
        if (relative) {
            thresh = threshold * positions[start].distance(positions[end])
        } else {
            thresh = threshold
        }

        if (maxDistance > thresh) {
            stack.push([start, maxDistanceIndex])
            stack.push([maxDistanceIndex, end])
        } else {
            // all positions are less than the threshold and can be removed
            for (let i = start + 1; i < end; i += 1) {
                keep[i] = false
            }
        }
    }

    return keep
}

/**
 * By Ken Fyrstenberg Nilsen
 *
 * drawImageProp(context, image [, x, y, width, height [,offsetX, offsetY]])
 *
 * If image and context are only arguments rectangle will equal canvas
*/
function drawImageProp(ctx, img, x, y, w, h, offsetX, offsetY) {
    if (arguments.length === 2) {
        x = y = 0;
        w = ctx.canvas.width;
        h = ctx.canvas.height;
    }

    // default offset is center
    offsetX = typeof offsetX === "number" ? offsetX : 0.5;
    offsetY = typeof offsetY === "number" ? offsetY : 0.5;

    // keep bounds [0.0, 1.0]
    if (offsetX < 0) offsetX = 0;
    if (offsetY < 0) offsetY = 0;
    if (offsetX > 1) offsetX = 1;
    if (offsetY > 1) offsetY = 1;

    var iw = img.width,
        ih = img.height,
        r = Math.min(w / iw, h / ih),
        nw = iw * r,   // new prop. width
        nh = ih * r,   // new prop. height
        cx, cy, cw, ch, ar = 1;

    // decide which gap to fill    
    if (nw < w) ar = w / nw;
    if (Math.abs(ar - 1) < 1e-14 && nh < h) ar = h / nh;  // updated
    nw *= ar;
    nh *= ar;

    // calc source rectangle
    cw = iw / (nw / w);
    ch = ih / (nh / h);

    cx = (iw - cw) * offsetX;
    cy = (ih - ch) * offsetY;

    // make sure source rectangle is valid
    if (cx < 0) cx = 0;
    if (cy < 0) cy = 0;
    if (cw > iw) cw = iw;
    if (ch > ih) ch = ih;

    // fill image in dest. rectangle
    ctx.drawImage(img, cx, cy, cw, ch, x, y, w, h);
}

new App()
