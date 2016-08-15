
'use strict'

/**
 * @license
 * Copyright Little Star Media Inc. and other contributors.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the
 * 'Software'), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit
 * persons to whom the Software is furnished to do so, subject to the
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
 * NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 * USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/**
 * The Axis module
 *
 * @module axis
 * @type {Function}
 */

/**
 * Module dependencies
 * @private
 */

var three = require('three')
var dom = require('domify')
var emitter = require('component-emitter')
var events = require('component-events')
var raf = require('raf')
var hasWebGL = require('has-webgl')
var fullscreen = require('@littlstar/fullscreen')
var merge = require('merge')
var pkg = require('./package.json')

/**
 * Local dependencies
 * @private
 */

var tpl = require('./template')
var Projection = require('./projection')
var createCamera = require('./camera')
var geometries = require('./geometry')
var State = require('./state')
var isImage = require('./util').isImage
var constants = require('./constants')

// install THREE.js addons
Axis.THREE = three
require('@littlstar/three-canvas-renderer')(three)
require('@littlstar/three-vr-effect')(three)

// uncomment to enable debugging
// window.DEBUG = true;

var COMPANY = 'LITTLSTAR - (www.Littlstar.com) [Little Star Media, Inc] '
var YEAR = new Date().getUTCFullYear()
console.info('Axis@v%s\n\tReport bugs to %s (%s)\n\tCopyright %d %s',
            pkg.version,
            pkg.bugs.url,
            pkg.bugs.email,
            YEAR, COMPANY)

// frame click threshold
var FRAME_CLICK_THRESHOLD = constants.FRAME_CLICK_THRESHOLD

// min/max wheel distances
var MIN_WHEEL_DISTANCE = constants.MIN_WHEEL_DISTANCE
var MAX_WHEEL_DISTANCE = constants.MAX_WHEEL_DISTANCE

// min/max x/y coordinates
var MIN_Y_COORDINATE = constants.MIN_Y_COORDINATE
var MAX_Y_COORDINATE = constants.MAX_Y_COORDINATE
var MIN_X_COORDINATE = constants.MIN_X_COORDINATE
var MAX_X_COORDINATE = constants.MAX_X_COORDINATE

// defaults
var DEFAULT_FOV = constants.DEFAULT_FOV

// expose util
Axis.util = require('./util')

/**
 * Creates the correct geometry for
 * the current content in axis
 *
 * @private
 * @param {Axis} axis
 * @param {String} override
 */

function getCorrectGeometry (axis, override) {
  var dimensions = axis.dimensions()
  var ratio = dimensions.ratio
  var geo = null
  var m = Math.sqrt(ratio)

  if (override) {
    geo = axis.geometry(override)
  } else if (axis.state.options.box) {
    geo = axis.geometry('box')
  } else if (axis.state.projectionrequested === 'flat') {
    geo = axis.geometry('plane')
  } else if (m <= 2) {
    geo = axis.geometry('sphere')
  } else if (!isNaN(ratio)) {
    geo = axis.geometry('cylinder')
  }

  return geo
}

/**
 * Creates a renderer based on options
 *
 * @private
 * @param {Object} opts
 * @return {Object}
 */

function createRenderer (opts) {
  opts = opts || {}
  var useWebgl = !opts.webgl && hasWebGL

  if (typeof opts.renderer === 'object') {
    return opts.renderer
  }

  if (useWebgl) {
    return new three.WebGLRenderer({
      // antialias: true,
    })
  } else {
    return new three.CanvasRenderer()
  }
}

/**
 * Creates a texture from a video DOM Element
 *
 * @private
 * @param {Element} video
 * @return {THREE.Texture}
 */

function createVideoTexture (video) {
  var texture = null
  video.width = video.videoWidth
  video.height = video.videoHeight
  texture = new three.Texture(video)

  texture.format = three.RGBFormat
  texture.minFilter = three.LinearFilter
  texture.magFilter = three.LinearFilter
  texture.image.width = video.videoWidth
  texture.image.height = video.videoHeight

  return texture
}

/**
 * Axis constructor
 *
 * @public
 * @default
 * @class Axis
 * @extends EventEmitter
 * @param {Object} parent - Parent DOM Element
 * @param {Object} [opts] - Constructor ptions passed to the axis
 * state instance.
 * @see {@link module:axis/state~State}
 */

module.exports = Axis
function Axis (parent, opts) {
  // normalize options
  opts = (opts = opts || {})

  // disable vr if `navigator.getVRDevices' isn't defined
  if (typeof navigator.getVRDevices !== 'function') {
    opts.vr = false
  }

  // ensure instance
  if (!(this instanceof Axis)) {
    return new Axis(parent, opts)
  } else if (!(parent instanceof window.Element)) {
    throw new TypeError('Expecting DOM Element')
  }

  var self = this

  /** Parent DOM node element. */
  this.parent = parent

  /** Instance constainer DOM element. */
  this.domElement = dom(tpl)

  /** Current axis orientation. */
  this.orientation = {x: 0, y: 0}

  /** Instance video DOM element. */
  this.video = this.domElement.querySelector('video')
  this.video.onerror = console.warn.bind(console)
  this.video.parentElement.removeChild(this.video)

  /** Axis' scene instance. */
  this.scene = null

  /** Axis' renderer instance.*/
  this.renderer = createRenderer(opts)

  if (opts.allowPreviewFrame && !isImage(opts.src)) {
    delete opts.allowPreviewFrame
    opts.isPreviewFrame = true
    this.previewDomElement = document.createElement('div')
    this.previewFrame = new Axis(this.previewDomElement, opts)
    this.previewFrame.once('ready', function () {
      self.previewFrame.video.volume = 0
      self.previewFrame.video.muted = true
      self.previewFrame.video.currentTime = 0
      self.previewFrame.video.pause()
    })
    delete opts.isPreviewFrame
    this.once('render', function () {
      this.previewFrame.render()
    })
  }

  /** Axis' texture instance. */
  this.texture = null

  /** Axis' controllers. */
  this.controls = {}

  /** Axis' state instance. */
  this.state = new State(this, opts)

  /** Axis' projections instance. */
  this.projections = new Projection(this)

  // install viewport projections
  this.projection('flat', require('./projection/flat'))
  this.projection('fisheye', require('./projection/fisheye'))
  this.projection('equilinear', require('./projection/equilinear'))
  this.projection('tinyplanet', require('./projection/tinyplanet'))

  /** Axis' camera instance. */
  this.camera = createCamera(this)

  function getRadius () {
    var dimensions = self.dimensions()
    var radius = 0
    if (self.geometry() === 'cylinder' ||
        Math.sqrt(dimensions.ratio) <= 2) {
      radius = dimensions.width / 4
      radius = radius / 2
    } else {
      radius = dimensions.width / 6
    }
    return radius | 0
  }

  // setup default state when ready
  this.once('ready', function () {
    this.debug('ready')

    if (opts.time || opts.t) {
      self.video.currentTime = parseFloat(opts.time) || parseFloat(opts.t) || 0
    }

    var fov = opts.fov
    var x = opts && opts.orientation ? opts.orientation.x : 0
    var y = opts && opts.orientation ? opts.orientation.y : Math.PI / 2

    if (typeof x === 'number' && !isNaN(x)) {
      this.orientation.x = x
    } else {
      this.orientation.x = 0
    }

    if (typeof y === 'number' && !isNaN(y)) {
      this.orientation.y = y
    } else {
      this.orientation.y = 0
    }

    if (!fov) {
      fov = DEFAULT_FOV
    }

    this.state.radius = getRadius()
    this.fov(fov)
    this.refreshScene()

    // initialize projection orientation if opts x and y are 0
    if (opts.projection) {
      this.projection(opts.projection)
    }
  })

  this.on('source', function () {
    this.once('load', function () {
      var fov = opts.fov

      if (!fov) {
        fov = DEFAULT_FOV
      }

      this.state.radius = getRadius()
      this.fov(fov)
      this.refreshScene()
    })
  })

  /**
   * Sets an attribute on the instance's
   * video DOM element from options passed in
   * to the constructor.
   *
   * @private
   * @param {String} property
   */

  function setVideoAttribute (property) {
    if (opts[property]) {
      self.video.setAttribute(property, opts[property])
    }
  }

  // set video options
  setVideoAttribute('preload')
  setVideoAttribute('autoplay')
  setVideoAttribute('crossorigin')
  setVideoAttribute('loop')
  setVideoAttribute('muted')

  // event delegation manager
  var eventDelegation = {}

  // init window events
  eventDelegation.window = events(window, this)
  eventDelegation.window.bind('resize')
  eventDelegation.window.bind('blur')

  // init video events
  eventDelegation.video = events(this.video, this)
  eventDelegation.video.bind('canplaythrough')
  eventDelegation.video.bind('loadeddata')
  eventDelegation.video.bind('play')
  eventDelegation.video.bind('pause')
  eventDelegation.video.bind('playing')
  eventDelegation.video.bind('progress')
  eventDelegation.video.bind('timeupdate')
  eventDelegation.video.bind('loadstart')
  eventDelegation.video.bind('waiting')
  eventDelegation.video.bind('ended')

  // init dom element events
  eventDelegation.element = events(this.domElement, this)
  eventDelegation.element.bind('click')
  eventDelegation.element.bind('touch', 'onclick')
  eventDelegation.element.bind('mousemove')
  eventDelegation.element.bind('mousewheel')
  eventDelegation.element.bind('mousedown')
  eventDelegation.element.bind('mouseleave')
  eventDelegation.element.bind('mouseup')
  eventDelegation.element.bind('touchstart')
  eventDelegation.element.bind('touchend')
  eventDelegation.element.bind('touchmove')

  // renderer options
  try {
    this.renderer.autoClear = opts.autoClear != null ? opts.autoClear : true
    this.renderer.setPixelRatio(opts.devicePixelRatio || window.devicePixelRatio)
    this.renderer.setClearColor(opts.clearColor || 0xfff, 0.5)
  } catch (e) {
    console.warn(e)
  }

  // attach renderer to instance node container
  this.domElement.querySelector('.container').appendChild(this.renderer.domElement)

  // mute if explicitly set
  if (opts.muted) {
    this.mute(true)
  }

  if (!opts.isPreviewFrame) {
    // Initializes controllers
    this.initializeControllers(merge({
      keyboard: true, mouse: true
    }, opts.controls))
  }

  // initial volume
  this.volume(opts.volume || 1)

  // initialize frame source
  this.src(opts.src)

  // handle fullscreen changing
  this.on('fullscreenchange', function () {
    this.debug('fullscreenchange')
    this.state.update('isFocused', true)
    this.state.update('isAnimating', false)

    if (this.state.isFullscreen) {
      // temporary set this;
      this.state.tmp.forceFocus = this.state.forceFocus
      this.state.forceFocus = true
      if (this.state.isVREnabled) {
        raf(function () {
          this.size(window.screen.width, window.screen.height)
        }.bind(this))
      }
      this.emit('enterfullscreen')
    } else {
      this.state.forceFocus = this.state.tmp.forceFocus != null
        ? this.state.tmp.forceFocus
        : false

      if (this.state.isVREnabled) {
        // @TODO(werle) - not sure how to fix this bug but the scene
        // needs to be re-rendered
        raf(function () { this.render() }.bind(this))
      }

      this.size(this.state.lastSize.width, this.state.lastSize.height)
      this.state.update('lastSize', {width: null, height: null})
      this.emit('exitfullscreen')
    }
  })
}

// mixin `Emitter'
emitter(Axis.prototype)

/**
 * Handle `onclick' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onclick = function (e) {
  this.debug('onclick')
  var now = Date.now()
  var timestamp = this.state.mousedownTimestamp
  var isClickable = this.state.isClickable
  var isImage = this.state.isImage
  var isPlaying = this.state.isPlaying
  var delta = (now - timestamp)

  if (!isClickable || delta > FRAME_CLICK_THRESHOLD) {
    return false
  }

  e.preventDefault()

  if (!isImage) {
    if (isPlaying) {
      this.pause()
    } else {
      this.play()
    }
  }

  /**
   * Click event.
   *
   * @public
   * @event module:axis~Axis#click
   * @type {Object}
   */

  this.emit('click', e)
}

/**
 * Handle `oncanplaythrough' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.oncanplaythrough = function (e) {
  var ratio = this.dimensions().ratio
  var r2 = Math.sqrt(ratio)
  this.debug('oncanplaythrough')
  this.state.duration = this.video.duration
  this.emit('canplaythrough', e)
  this.emit('load')
  if (this.texture == null ||
      (this.texture && this.texture.image && this.texture.image.tagName !== 'VIDEO')) {
    if (this.texture && this.texture.dispose) {
      this.texture.dispose()
    }

    this.texture = createVideoTexture(this.video)
    if (this.state.options.box) {
      this.texture.mapping = three.SphericalReflectionMapping
      this.texture.needsUpdate = true
      this.texture.repeat.set(1, 1)
    } else if (r2 <= 2) {
      this.texture.mapping = three.SphericalReflectionMapping
    }
  }
  this.state.ready()
  if (!this.state.shouldAutoplay && !this.state.isPlaying) {
    this.state.update('isPaused', true)
    this.video.pause()
  } else if (!this.state.isStopped) {
    this.video.play()
  }
}

/**
 * Handle `onloadeddata' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onloadeddata = function (e) {
  this.debug('loadeddata')
}

/**
 * Handle `onplay' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onplay = function (e) {
  this.debug('onplay')
  this.state.update('isPaused', false)
  this.state.update('isStopped', false)
  this.state.update('isEnded', false)
  this.state.update('isPlaying', true)
  this.emit('play', e)
}

/**
 * Handle `onpause' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onpause = function (e) {
  this.debug('onpause')
  this.state.update('isPaused', true)
  this.state.update('isPlaying', false)
  this.emit('pause', e)
}

/**
 * Handle `onplaying' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onplaying = function (e) {
  this.debug('onplaying')
  this.state.update('isPaused', false)
  this.state.update('isPlaying', true)
  this.emit('playing', e)
}

/**
 * Handle `onwaiting' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onwaiting = function (e) {
  this.debug('onwaiting')
  this.emit('wait', e)
}

/**
 * Handle `onloadstart' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onloadstart = function (e) {
  this.debug('onloadstart')
  this.emit('loadstart', e)
}

/**
 * Handle `onprogress' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onprogress = function (e) {
  var percent = this.getPercentLoaded()
  e.percent = percent
  this.state.update('percentloaded', percent)
  this.debug('onprogress')
  this.emit('progress', e)
}

/**
 * Handle `ontimeupdate' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.ontimeupdate = function (e) {
  this.debug('ontimeupdate')
  e.percent = this.video.currentTime / this.video.duration * 100
  this.state.update('duration', this.video.duration)
  this.state.update('currentTime', this.video.currentTime)
  this.emit('timeupdate', e)
}

/**
 * Handle `onended' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onended = function (e) {
  this.debug('onended')
  this.state.update('isEnded', true)
  this.state.update('isPlaying', false)
  this.state.update('isPlaying', false)
  this.state.update('isStopped', true)
  this.emit('end')
  this.emit('ended')
}

/**
 * Handle `onmousedown' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onmousedown = function (e) {
  this.debug('onmousedown')
  this.state.update('mousedownTimestamp', Date.now())
  this.state.update('isAnimating', false)
  this.state.update('dragstart', {x: e.pageX, y: e.pageY})
  this.state.update('isMousedown', true)
  this.emit('mousedown', e)
}

/**
 * Handle `onmouseup' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onmouseup = function (e) {
  this.debug('onmouseup')
  this.state.update('isMousedown', false)
  this.emit('mouseup', e)
}

/**
 * Handle `onmouseleave' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onmouseleave = function (e) {
  this.debug('onmouseleave')
  this.state.update('isMousedown', false)
  this.emit('mouseleave', e)
}

/**
 * Handle `ontouchstart' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.ontouchstart = function (e) {
  var touch = e.touches[0]
  this.debug('ontouchstart')
  this.state.update('mousedownTimestamp', Date.now())
  this.state.update('isAnimating', false)
  this.state.update('dragstart', {x: touch.pageX, y: touch.pageY})
  this.state.update('isTouching', true)
  this.emit('touchstart', e)
}

/**
 * Handle `ontouchend' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.ontouchend = function (e) {
  this.debug('ontouchend')
  this.state.update('isTouching', false)
  this.emit('touchend', e)
}

/**
 * Handle `onresize' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onresize = function (e) {
  this.debug('onresize')
  var isResizable = this.state.isResizable
  var isFullscreen = this.state.isFullscreen
  var containerStyle = window.getComputedStyle(this.domElement)
  var canvasStyle = window.getComputedStyle(this.renderer.domElement)
  var containerWidth = parseFloat(containerStyle.width)
  var containerHeight = parseFloat(containerStyle.width)
  var canvasWidth = parseFloat(canvasStyle.width)
  var canvasHeight = parseFloat(canvasStyle.height)
  var aspectRatio = canvasWidth / canvasHeight
  var resized = false
  var newWidth = 0
  var newHeight = 0

  if (isResizable && !isFullscreen) {
    // adjust for width while accounting for height
    if (canvasWidth > containerWidth ||
        canvasWidth < containerWidth &&
        canvasWidth < this.state.originalsize.width) {
      newWidth = containerWidth
      newHeight = containerWidth / aspectRatio
      resized = true
    } else if (canvasHeight > containerHeight ||
               (canvasHeight > containerHeight &&
                canvasHeight < this.state.originalsize.height)) {
      newHeight = containerHeight
      newWidth = containerHeight * aspectRatio
      resized = true
    } else {
      this.fov(this.state.originalfov)
    }

    if (resized) {
      this.size(newWidth, newHeight)
      this.emit('resize', {
        width: this.state.width,
        height: this.state.height
      })
    }
  }
}

/**
 * Handle `window.onblur' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onblur = function () {
  this.state.isMousedown = false
  this.state.isTouching = false
  if (this.controls.mouse) {
    this.controls.mouse.state.isMousedown = false
  }

  if (this.controls.keyboard) {
    this.controls.keyboard.reset()
  }
}

/**
 * Handle `onmousemove' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onmousemove = function (e) {
  this.debug('onmousemove')
  var xOffset = 0
  var yOffset = 0
  var x = this.state.pointerX
  var y = this.state.pointerY

  if (this.state.isMousedown) {
    xOffset = e.pageX - this.state.dragstart.x
    yOffset = e.pageY - this.state.dragstart.y

    this.state.update('dragstart', {
      x: e.pageX,
      y: e.pageY
    })

    if (this.state.isInverted) {
      x -= xOffset
      y += yOffset
    } else {
      x += xOffset
      y -= yOffset
    }

    this.state.update('pointerX', x)
    this.state.update('pointerY', y)
    this.cache({pointerX: x, pointerY: y})
  }

  this.emit('mousemove', e)
}

/**
 * Handle `ontouchmove' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.ontouchmove = function (e) {
  this.debug('ontouchmove')
  var xOffset = 0
  var yOffset = 0
  var touch = e.touches[0]
  var x = this.state.pointerX
  var y = this.state.pointerY

  if (!this.state.isTouching) { return }
  if (e.touches.length === 1) {
    e.preventDefault()

    xOffset = touch.pageX - this.state.dragstart.x
    yOffset = touch.pageY - this.state.dragstart.y

    this.state.update('dragstart', {x: touch.pageX, y: touch.pageY})

    if (this.state.isInverted) {
      x -= xOffset
      y += yOffset
    } else {
      x += xOffset
      y -= yOffset
    }

    this.state.update('pointerX', x)
    this.state.update('pointerY', y)
    this.cache({pointerX: x, pointerY: y})
    this.emit('touchmove', e)
  }
}

/**
 * Handle `onmousewheel' event
 *
 * @private
 * @param {Event} e
 */

Axis.prototype.onmousewheel = function (e) {
  this.debug('onmousewheel')
  var velocity = this.state.scrollVelocity
  var min = MIN_WHEEL_DISTANCE
  var max = MAX_WHEEL_DISTANCE

  if (typeof velocity !== 'number' || !this.state.allowWheel) {
    return false
  }

  e.preventDefault()

  if (e.wheelDeltaY != null) { // chrome
    this.state.fov -= e.wheelDeltaY * velocity
  } else if (e.wheelDelta != null) { // ie
    this.state.fov -= window.event.wheelDelta * velocity
  } else if (e.detail != null) { // firefox
    this.state.fov += e.detail * velocity
  }

  if (this.state.fov < min) {
    this.state.fov = min
  } else if (this.state.fov > max) {
    this.state.fov = max
  }

  this.camera.setFocalLength(this.state.fov)
  this.emit('mousewheel', e)
}

/**
 * Sets frame size
 *
 * @public
 * @param {Number} width
 * @param {Number} height
 */

Axis.prototype.size = function (width, height) {
  this.debug('size', width, height)

  if (width == null) width = this.state.width
  if (height == null) height = this.state.height

  var container = this.domElement.querySelector('.container')
  this.state.width = width
  this.state.height = height

  if (this.camera) {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  if (this.renderer) {
    this.renderer.setSize(width, height)
  }

  if (this.state.originalsize.width == null) {
    this.state.originalsize.width = width
  }

  if (this.state.originalsize.height == null) {
    this.state.originalsize.height = height
  }

  if (this.previewFrame) {
    this.previewFrame.size(width, height)
  }

  if (container) {
    container.style.width = width + 'px'
    container.style.height = height + 'px'
  }
  this.emit('size', width, height)
  return this
}

/**
 * Sets or gets video src
 *
 * @public
 * @param {String} [src] - Source string
 * @param {Boolean} [preservePreviewFrame = false] - Predicate indicate if
 * preview source should be preserved.
 */

Axis.prototype.src = function (src, preservePreviewFrame) {
  var self = this
  function onImageLoaded () {
    self.texture.image.onload = null
    self.state.ready()
    self.emit('load')
    self.texture.needsUpdate = true
    self.fov(DEFAULT_FOV)
    self.refreshScene()
  }

  if (src) {
    this.debug('src', src)
    this.state.update('src', src)
    this.state.update('isReady', false)
    this.state.update('lastDimensions', this.dimensions())

    if (!isImage(src) || this.state.forceVideo && src !== this.video.src) {
      this.state.update('isImage', false)

      if (typeof this.state.options.loader === 'function') {
        this.state.options.loader(this, src, this.video)
      } else {
        this.video.src = src
        this.video.load()
        this.video.onload = function () {
          this.onload = null
          if (self.texture) {
            self.texture.needsUpdate = true
          }
        }
      }
    } else {
      this.state.update('isImage', true)
      // initialize texture
      if (this.state.isCrossOrigin) {
        three.ImageUtils.crossOrigin = 'anonymous'
      }

      var loader = new three.TextureLoader()
      var crossOrigin = (
        this.state.options.crossOrigin ||
        this.state.options.crossorigin ||
        false
      )

      loader.setCrossOrigin(crossOrigin)
      this.texture = loader.load(src, onImageLoaded)
      this.texture.minFilter = three.LinearFilter
      this.texture.magFilter = three.LinearFilter
      this.texture.generateMipmaps = false
    }

    if (!preservePreviewFrame && this.previewFrame) {
      this.previewFrame.src(src)
    }

    this.emit('source', src)
    return this
  } else {
    return this.state.src
  }
}

/**
 * Plays video frame
 *
 * @public
 */

Axis.prototype.play = function () {
  var video = this.video
  if (!this.state.isImage) {
    if (this.state.isEnded) {
      video.currentTime = 0
    }
    this.debug('play')
    video.play()
  }
  return this
}

/**
 * Pauses video frame
 *
 * @public
 */

Axis.prototype.pause = function () {
  if (!this.state.isImage) {
    this.debug('pause')
    this.state.update('isPlaying', false)
    this.state.update('isPaused', true)
    this.video.pause()
  }
  return this
}

/**
 * Takes video to fullscreen
 *
 * @public
 * @param {Element} el
 */

Axis.prototype.fullscreen = function (el) {
  var opts = null
  if (!fullscreen.supported) {
    return
  } else if (typeof el === 'boolean' && el === false) {
    fullscreen.exit()
    return
  } else if (this.state.isVREnabled) {
    opts = {vrDisplay: this.state.vrHMD}
  } else if (!this.state.isFullscreen) {
    var canvasStyle = window.getComputedStyle(this.renderer.domElement)
    this.state.update('lastSize', {
      width: parseFloat(canvasStyle.width),
      height: parseFloat(canvasStyle.height)
    })

    this.size(window.screen.width, window.screen.height)
  }

  this.debug('fullscreen')
  this.state.update('isFullscreen', true)
  fullscreen(el || this.domElement, opts)
}

/**
 * Set or get volume on frame
 *
 * @public
 * @param {Number} volume
 */

Axis.prototype.volume = function (volume) {
  if (!this.state.isImage) {
    if (volume == null) {
      return this.video.volume
    }
    this.debug('volume', volume)
    this.state.update('lastVolume', this.video.volume)
    this.video.volume = volume
    this.emit('volume', volume)
  }
  return this
}

/**
 * Mutes volume
 *
 * @public
 * @param {Boolean} mute - optional
 */

Axis.prototype.mute = function (mute) {
  this.debug('mute', mute)
  if (!mute) {
    this.video.muted = false
    this.state.update('isMuted', false)
    this.volume(this.state.lastVolume)
  } else {
    this.state.update('isMuted', true)
    this.video.muted = true
    this.volume(0)
    this.emit('mute')
  }
  return this
}

/**
 * Unmute volume
 *
 * @public
 * @param {Boolean} mute - optional
 */

Axis.prototype.unmute = function (mute) {
  if (!this.state.isImage) {
    this.mute(false)
    this.emit('unmute')
  }
  return this
}

/**
 * Refreshes frame
 *
 * @public
 */

Axis.prototype.refresh = function () {
  var constraints = this.projections.constraints || {}
  var video = this.video
  var now = Date.now()
  var x = this.state.pointerX
  var y = this.state.pointerY

  this.debug('refresh')

  if (!this.state.isImage) {
    if (video.readyState >= video.HAVE_ENOUGH_DATA) {
      if (now - this.state.lastRefresh >= 64) {
        this.state.lastRefresh = now
        if (this.texture != null) {
          this.texture.needsUpdate = true
        }
      }
    }
  }

  if (constraints.panoramic) {
    if (this.camera) {
      this.camera.fov = this.state.fov
      this.camera.updateProjectionMatrix()
    }

    // normalize y coordinate
    y = Math.max(MIN_Y_COORDINATE, Math.min(MAX_Y_COORDINATE, y))

    // normalize x coordinate
    if (x > MAX_X_COORDINATE) {
      x = x - MAX_X_COORDINATE
    } else if (x < MIN_X_COORDINATE) {
      x = x + MAX_X_COORDINATE
    }

    this.state.update('pointerX', x)
    this.state.update('pointerY', y)
    this.cache(this.coords())
  } else {
    this.state.update('pointerX', 90)
    this.state.update('pointerY', 0)
  }

  if (this.state.isFullscreen) {
    if (this.state.lastDevicePixelRatio !== window.devicePixelRatio) {
      this.state.lastDevicePixelRatio = window.devicePixelRatio
      this.size(window.screen.width / window.devicePixelRatio,
                window.screen.height / window.devicePixelRatio)
    }
  }

  this.emit('refresh')
  return this
}

/**
 * Refresh frame
 *
 * @public
 */

Axis.prototype.resizable = function (resizable) {
  if (typeof resizable === 'undefined') return this.state.isResizable
  this.state.update('isResizable', resizable)
  return this
}

/**
 * Seek to time in seconds
 *
 * @public
 * @param {Number} seconds
 * @param {Boolean} emit
 */

Axis.prototype.seek = function (seconds, emit) {
  if (this.state.isImage) { return this }
  var isReady = this.state.isReady
  var self = this
  var ua = navigator.userAgent.toLowerCase()
  function afterseek () {
    var isPlaying = self.state.isPlaying
    var video = self.video
    seconds = seconds || 0
    video.currentTime = seconds

    if (seconds === 0) {
      self.state.update('isStopped', true)
    } else {
      self.state.update('isStopped', false)
    }

    if (isPlaying) {
      self.play()
    }

    if (emit) self.emit('seek', seconds)

    setTimeout(function () {
      self.debug('Attempting seeking correction')
      if (video.readyState < video.HAVE_ENOUGH_DATA) {
        self.debug('Video state does not have enough data.')
        self.debug('Reloading video...')
        video.load()
        self.debug('Seeking video to %d...', seconds)
        video.currentTime = seconds
        if (isPlaying) {
          self.debug('Playing video at %d...', seconds)
          video.play()
        }
      }
    }, 1000)
  }
  if (!this.state.isImage) {
    // firefox emits `oncanplaythrough' when changing the
    // `.currentTime' property on a video tag so we need
    // to listen one time for that event and then seek to
    // prevent errors from occuring.
    if (/firefox/.test(ua) && !isReady) {
      this.video.oncanplaythrough = function () {
        this.oncanplaythrough = function () {}
        afterseek()
      }
    } else if (isReady) {
      afterseek()
    } else {
      this.once('ready', afterseek)
    }
  }
  return this
}

/**
 * Fast forward `n' amount of seconds
 *
 * @public
 * @param {Number} seconds
 */

Axis.prototype.foward = function (seconds) {
  if (!this.state.isImage) {
    this.seek(this.video.currentTime + seconds)
    this.emit('forward', seconds)
  }
  return this
}

/**
 * Rewind `n' amount of seconds
 e
 * @public
 * @param {Number} seconds
 */

Axis.prototype.rewind = function (seconds) {
  if (!this.state.isImage) {
    this.seek(this.video.currentTime - seconds)
    this.emit('rewind', seconds)
  }
  return this
}

/**
 * Use plugin with frame
 *
 * @public
 * @param {Function} fn
 */

Axis.prototype.use = function (fn) {
  fn(this)
  return this
}

/**
 * Draws frame
 *
 * @public
 */

Axis.prototype.draw = function () {
  if (this.renderer && this.scene && this.camera) {
    this.emit('beforedraw')
    if (!this.state.isVREnabled) {
      this.renderer.render(this.scene, this.camera)
    }
    this.emit('draw')
  }

  return this
}

/**
 * Look at a position in a [x, y, z] vector
 *
 * @public
 * @param {Number} x
 * @param {Number} y
 * @param {Number} z
 */

Axis.prototype.lookAt = function (x, y, z) {
  if (this.camera) {
    x = this.camera.target.x = x
    y = this.camera.target.y = y
    z = this.camera.target.z = z
    this.camera.lookAt(this.camera.target)
    this.camera.position.copy(this.camera.target).negate()
    this.emit('lookat', {x: x, y: y, z: z})
  }

  return this
}

/**
 * Renders the frame
 *
 * @public
 * @param {Boolean} [shoudLoop = true] - Predicate indicating if a render loop shouls start.
 */

Axis.prototype.render = function (shoudLoop) {
  var domElement = this.domElement
  var self = this
  var style = window.getComputedStyle(this.parent)
  var width = this.state.width || parseFloat(style.width)
  var height = this.state.height || parseFloat(style.height)
  var aspectRatio = 0

  if (this.state.isPreviewFrame) {
    if (shoudLoop == null) {
      shoudLoop = false
    }
  }

  // attach dom node to parent
  if (!this.parent.contains(this.domElement)) {
    this.parent.appendChild(this.domElement)
  }

  if (height === 0) {
    height = Math.min(width, window.innerHeight)
    aspectRatio = width / height
    height = height / aspectRatio
  }

  // initialize size
  this.size(width, height)

  // start animation loop
  if (shoudLoop !== false) {
    raf.cancel(this.state.animationFrameID)
    if (!this.state.animationFrameID || this.state.animationFrameID === 0) {
      this.state.animationFrameID = raf(function loop () {
        var parentElement = domElement.parentElement
        if (parentElement && parentElement.contains(domElement)) {
          self.state.animationFrameID = raf(loop)
          self.update()
        }
      })
    }
  }

  this.emit('render')
  return this
}

/**
 * Sets view offset
 *
 * @public
 * @see {@link http://threejs.org/docs/#Reference/Cameras/PerspectiveCamera}
 */

Axis.prototype.offset = function () {
  this.camera.setViewOffset.apply(this.camera, arguments)
  return this
}

/**
 * Set or get height
 *
 * @public
 * @param {Number} height - optional
 */

Axis.prototype.height = function (height) {
  if (height == null) {
    return this.state.height
  }

  this.size(this.state.width, height)
  this.emit('height', height)
  return this
}

/**
 * Set or get width
 *
 * @public
 * @param {Number} width - optional
 */

Axis.prototype.width = function (width) {
  if (width == null) {
    return this.state.width
  }

  this.size(width, this.state.height)
  this.emit('width', width)
  return this
}

/**
 * Set or get projection
 *
 * @public
 * @param {String} type - optional
 * @param {Function} fn - optional
 */

Axis.prototype.projection = function (type, fn) {
  // normalize type string
  type = typeof type === 'string'
    ? type.toLowerCase().replace(/\s+/g, '')
    : null

  // define
  if (type && typeof fn === 'function') {
    this.projections.set(type, fn)
    return this
  }

  // apply
  if (type) {
    if (this.state.isReady) {
      if (type !== this.projections.current &&
          this.projections.contains(type)) {
        this.projections.apply(type)
      }
    } else {
      this.once('ready', function () {
        this.projection(type)
      })
    }

    return this
  }

  // get
  return this.projections.current
}

/**
 * Destroys frame
 *
 * @public
 */

Axis.prototype.destroy = function () {
  try {
    this.scene = null
    this.texture = null
    this.camera = null
    this.stop()
    raf.cancel(this.state.animationFrameID)
    this.state.animationFrameID = 0
    this.state.reset()
    this.renderer.resetGLState()
    empty(this.domElement)
    this.domElement.parentElement.removeChild(this.domElement)
  } catch (e) { console.warn(e) }
  function empty (el) {
    try {
      while (el.lastChild) el.removeChild(el)
    } catch (e) {}
  }
  return this
}

/**
 * Stops playback if applicable
 *
 * @public
 */

Axis.prototype.stop = function () {
  if (this.state.isImage) { return }
  this.video.pause()
  this.video.currentTime = 0
  this.state.update('isStopped', true)
  this.state.update('isPlaying', false)
  this.state.update('isPaused', false)
  this.state.update('isAnimating', false)
  return this
}

/**
 * Sets or gets y coordinate
 *
 * @public
 * @param {Number} y - optional
 */

Axis.prototype.y = function (y) {
  if (y == null) {
    return this.state.pointerY
  }
  this.state.update('pointerY', y)
  return this
}

/**
 * Sets or gets x coordinate
 *
 * @public
 * @param {Number} x - optional
 */

Axis.prototype.x = function (x) {
  if (x == null) {
    return this.state.pointerX
  }
  this.state.update('pointerX', x)
  return this
}

/**
 * Sets or gets x/y coordinates
 *
 * @public
 * @param {Number} [x] - X coordinate
 * @param {Number} [y] - Y coordinate
 */

Axis.prototype.coords = function (x, y) {
  if (y == null && x == null) {
    return {
      pointerY: this.state.pointerY,
      pointerX: this.state.pointerX
    }
  }

  if (y != null) {
    this.state.update('pointerY', y)
  }

  if (x != null) {
    this.state.update('pointerX', x)
  }

  return this
}

/**
 * Refreshes and redraws current frame
 *
 * @public
 */

Axis.prototype.update = function () {
  if (!this.state.shouldUpdate) return this
  this.once('refresh', function () { this.draw() })
  this.once('draw', function () { this.emit('update') })
  return this.refresh()
}

/**
 * Sets or updates state cache
 *
 * @public
 * @param {Object} obj - optinal
 */

Axis.prototype.cache = function (o) {
  if (this.state.isConstrainedWith('cache')) {
    return this
  }

  if (typeof o === 'object') {
    merge(this.state.cache, o)
    return this
  } else {
    return this.state.cache
  }
}

/**
 * Outputs debug info if `window.DEBUG' is
 * defined
 *
 * @public
 * @param {Mixed} ...arguments - optional
 */

Axis.prototype.debug = function debug () {
  if (window.DEBUG) {
    console.debug.apply(console, arguments)
  }
  return this
}

/**
 * Gets geometry type string or sets geometry
 * type string and returns an instance of a
 * geometry if applicable.
 *
 * @public
 * @param {String} type - optional
 */

Axis.prototype.geometry = function (type) {
  if (type == null) {
    return this.state.geometry
  }
  try {
    var geo = geometries[type](this)
    this.state.update('geometry', type)
    return geo
  } catch (e) {
    return null
  }
}

/**
 * Returns the dimensions of the current
 * texture.
 *
 * @public
 */

Axis.prototype.dimensions = function () {
  var width = 0
  var height = 0

  if (this.state.isImage) {
    if (this.texture && this.texture.image) {
      height = this.texture.image.height
      width = this.texture.image.width
    }
  } else {
    height = this.video.videoHeight
    width = this.video.videoWidth
  }

  return {height: height, width: width, ratio: (width / height) || 0}
}

/**
 * Sets or gets the current field of view
 *
 * @public
 * @param {Number} fov - optional
 */

Axis.prototype.fov = function (fov) {
  if (fov == null) {
    return this.state.fov
  } else {
    if (!this.state.fov) {
      this.state.update('originalfov', fov)
    }
    this.state.update('fov', fov)
  }
  return this
}

/**
 * Enables VR mode.
 *
 * @public
 */

Axis.prototype.enableVRMode = function () {
  this.initializeControllers({vr: true})
  this.state.isVREnabled = true
  this.controls.vr.enable()
  return this
}

/**
 * Disables VR mode.
 *
 * @public
 */

Axis.prototype.disableVRMode = function () {
  this.initializeControllers({vr: false})
  this.state.isVREnabled = false
  this.controls.vr.disable()
  return this.render()
}

/**
 * Returns percent of media loaded.
 *
 * @public
 * @param {Number} [trackIndex = 0]- Index of track added.
 */

Axis.prototype.getPercentLoaded = function (trackIndex) {
  var video = this.video
  var percent = 0

  if (this.state.isImage) {
    percent = 100
  } else {
    try {
      percent = video.buffered.end(trackIndex || 0) / video.duration
    } catch (e) {
      this.debug('error', e)
      try {
        percent = video.bufferedBytes / video.bytesTotal
      } catch (e) {
        this.debug('error', e)
      }
    }

    percent = percent || 0
    percent *= 100
  }

  return Math.max(0, Math.min(percent, 100))
}

/**
 * Returns percent of media played if applicable.
 *
 * @public
 * @return {Number}
 */

Axis.prototype.getPercentPlayed = function () {
  return (this.video.currentTime / this.video.duration * 100) || 0
}

/**
 * Initializes axis controllers if not created. An
 * optional map can be used to indicate which controllers
 * should be re-initialized if already created.
 *
 * @public
 * @param {Object} [map] - Controllers to re-initialize.
 * @param {Boolean} [force] - Force initialization of all controllers.
 */

Axis.prototype.initializeControllers = function (map, force) {
  var controls = (this.controls = this.controls || {})
  map = map != null && typeof map === 'object' ? map : {}

  if (map.vr || force) {
    if (controls.vr) { controls.vr.destroy() }
    controls.vr = require('./controls/vr')(this)
  }

  if (map.mouse || force) {
    if (controls.mouse) { controls.mouse.destroy() }
    controls.mouse = require('./controls/mouse')(this)
  }

  if (map.touch || force) {
    if (controls.touch) { controls.touch.destroy() }
    controls.touch = require('./controls/touch')(this)
  }

  if (map.keyboard || force) {
    if (controls.keyboard) { controls.keyboard.destroy() }
    controls.keyboard = require('./controls/keyboard')(this)
  }

  if (map.orientation || force) {
    if (controls.orientation) { controls.orientation.destroy() }
    controls.orientation = require('./controls/orientation')(this)
  }

  if (map.pointer || force) {
    if (controls.pointer) { controls.pointer.destroy() }
    controls.pointer = require('./controls/pointer')(this)
  }

  if (controls.movement == null || map.movement || force) {
    if (controls.movement) { controls.movement.destroy() }
    controls.movement = require('./controls/movement')(this)
  }

  if (controls.default == null || map.default || force) {
    if (controls.default) { controls.default.destroy() }
    controls.default = (
      require('./controls/controller')(this).enable().target(this.camera)
    )
  }

  return this
}

/**
 * Returns a captured image at a specific moment in
 * time based on current orientation, field of view,
 * and projection type. If time is omitted then the
 * current time is used. An exisiting optional `Image`
 * object can be used otherwise a new one is created.
 * The `Image` object is returned and its `src`
 * attribute is set when the frame is able to capture
 * a preview. If the current texture is an image then
 * a preview image is generated immediately.
 *
 * @public
 * @name getCaptureImageAt
 * @param {Number} [time] - Optional Time to seek to preview.
 * @param {Image} [out] - Optional Image object to set src to.
 * @param {Function} [cb] - Optional callback called when image
 * source has been set.
 * @return {Image}
 */

Axis.prototype.getCaptureImageAt = function (time, out, cb) {
  var preview = this.previewFrame
  var image = null
  var mime = 'image/jpeg'
  var self = this

  function setCapture () {
    preview.orientation.x = self.orientation.x
    preview.orientation.y = self.orientation.y
    preview.refreshScene()
    preview.fov(self.fov())
    preview.projection(self.projection())
    raf(function check () {
      preview.camera.target.copy(self.camera.target)
      preview.camera.quaternion.copy(self.camera.quaternion)
      if (preview.state.isAnimating) {
        raf(check)
      } else {
        image.src = preview.renderer.domElement.toDataURL(mime)
      }
    })
  }

  function updatePreviewFrameVideo () {
    preview.update()
    preview.video.currentTime = time
    preview.pause()
  }

  if (arguments.length === 0) {
    time = null
    out = null
  } else if (arguments.length === 1) {
    if (typeof time === 'object') {
      out = time
      time = null
    }
  } else if (arguments.length === 2) {
    if (typeof out === 'function') {
      cb = out
      out = null
    }

    if (typeof time === 'object') {
      out = time
      time = null
    }
  }

  cb = typeof cb === 'function' ? cb : function () {}
  image = out || new window.Image()
  image.onload = function () {
    this.onload = null
    cb(null, this)
  }

  image.onerror = function (e) {
    this.onerror = null
    cb(e, this)
  }

  if (preview && !this.state.isImage) {
    raf(function () { preview.update() })
    preview.once('update', setCapture)
    if (preview.video.readyState < 4) {
      preview.video.onload = function () {
        preview.video.onload = null
        updatePreviewFrameVideo()
      }
      preview.video.load()
    } else {
      updatePreviewFrameVideo()
    }
  } else if (this.renderer.domElement) {
    raf(function () {
      image.src = self.renderer.domElement.toDataURL(mime)
    })
  }

  return image
}

/**
 * Returns a screenshot of the current rendered frame
 *
 * @public
 * @param {Image} [out] - Optional image to set source to.
 * @param {Function} [cb] - Optional callback when image has loaded
 * @return {Image}
 */

Axis.prototype.toImage = function (out, cb) {
  out = out || new window.Image()
  return this.getCaptureImageAt(out, cb)
}

/**
 * Initializes or refreshes current scene
 * for projection.
 *
 * @public
 * @return {Axis}
 */

Axis.prototype.refreshScene = function () {
  var material = null
  var isReady = this.state.isReady
  var texture = this.texture
  var scene = this.scene
  var mesh = null
  var faces = null
  var geo = null

  if (!texture || !isReady) { return this }

  if (!scene) {
    this.scene = new three.Scene()
  }

  // get geometry for content
  geo = getCorrectGeometry(this)
  faces = []

  // skip if geometry is unable to be determined
  if (!geo) { return this }

  if (scene && scene.children.length >= 1) {
    mesh = scene.children[0]
    material = mesh.material
    if (material.map !== texture) {
      material.map = texture
    }
  } else {
    // create material and mesh
    material = new three.MeshBasicMaterial({map: texture})

    // build mesh
    // uv cube mapping faces
    // (0, 1)                      (1, 1)
    //           ---- ---- ----
    //          |    |    |    |
    //          |    |    |    |
    // (0, .5)   ---- ---- ----    (1, .5)
    //          |    |    |    |
    //          |    |    |    |
    //           ---- ---- ----
    // (0, 0)                      (1, 0)
    //
    if (this.state.options.box) {
      var f1 = [
        new three.Vector2(0, 1),
        new three.Vector2(0, 0.5),
        new three.Vector2(1 / 3, 0.5),
        new three.Vector2(1 / 3, 1)
      ]

      var f2 = [
        new three.Vector2(1 / 3, 1),
        new three.Vector2(1 / 3, 0.5),
        new three.Vector2(2 / 3, 0.5),
        new three.Vector2(2 / 3, 1)
      ]

      var f3 = [
        new three.Vector2(2 / 3, 1),
        new three.Vector2(2 / 3, 0.5),
        new three.Vector2(1, 0.5),
        new three.Vector2(1, 1)
      ]

      var f4 = [
        new three.Vector2(0, 0.5),
        new three.Vector2(0, 0),
        new three.Vector2(1 / 3, 0),
        new three.Vector2(1 / 3, 0.5)
      ]

      var f5 = [
        new three.Vector2(1 / 3, 0.5),
        new three.Vector2(1 / 3, 0),
        new three.Vector2(2 / 3, 0.0),
        new three.Vector2(2 / 3, 0.5)
      ]

      var f6 = [
        new three.Vector2(2 / 3, 0.5),
        new three.Vector2(2 / 3, 0),
        new three.Vector2(1, 0),
        new three.Vector2(1, 0.5)
      ]

      faces[0] = [f1[0], f1[1], f1[3]]
      faces[1] = [f1[1], f1[2], f1[3]]

      faces[2] = [f2[0], f2[1], f2[3]]
      faces[3] = [f2[1], f2[2], f2[3]]

      faces[4] = [f3[0], f3[1], f3[3]]
      faces[5] = [f3[1], f3[2], f3[3]]

      faces[6] = [f4[0], f4[1], f4[3]]
      faces[7] = [f4[1], f4[2], f4[3]]

      faces[8] = [f5[0], f5[1], f5[3]]
      faces[9] = [f5[1], f5[2], f5[3]]

      faces[10] = [f6[0], f6[1], f6[3]]
      faces[11] = [f6[1], f6[2], f6[3]]

      geo.faceVertexUvs[0] = faces
    }

    mesh = new three.Mesh(geo, material)
    // set mesh scale
    material.overdraw = 1
    mesh.scale.x = -1
    // add mesh to scene
    this.scene.add(mesh)
  }

  return this
}

/**
 * Focuses frame
 *
 * @public
 * @return {Axis}
 */

Axis.prototype.focus = function () {
  this.state.update('isFocused', true)
  return this
}

/**
 * Unfocuses frame
 *
 * @public
 * @return {Axis}
 */

Axis.prototype.unfocus = function () {
  this.state.update('isFocused', false)
  return this
}

/**
 * Rotate around an axis with timing and
 * increment value
 *
 * @publc
 * @param {String} coord - x or y
 * @param {Object|Boolean} opts - Options to configure the rotation. If
 * the value is `false` then rotations will stop
 * @param {Number} opts.value - Value to increment rotation.
 * @param {Number} opts.every - Interval in milliseconds when to apply value
 * to the rotation around the coordniate axis.
 * @return {Axis}
 */

Axis.prototype.rotate = function (coord, opts) {
  var intervalRotations = this.state.intervalRotations
  var rotation = null
  var self = this

  if (typeof coord !== 'string') {
    throw new TypeError('Expecting coordinate to be a string.')
  }

  rotation = intervalRotations[coord]

  if (typeof opts === 'object' && opts) {
    if (typeof opts.value === 'number') {
      rotation.value = opts.value
    } else {
      throw new TypeError('Expecting .value to be a number')
    }

    if (typeof opts.every === 'number') {
      rotation.every = opts.every
    }

    clearTimeout(rotation.interval)
    rotation.interval = setTimeout(function interval () {
      var isMousedown = self.controls.mouse && self.controls.mouse.state.isMousedown
      var isTouching = self.controls.touch && self.controls.touch.state.isTouching
      var isKeydown = self.controls.keyboard && self.controls.keyboard.state.isKeydown
      clearTimeout(rotation.interval)
      if (rotation.every !== 0 && rotation.value !== 0) {
        setTimeout(interval, rotation.every)
      }

      if (!(isMousedown || isTouching || isKeydown)) {
        self.orientation[coord] += rotation.value
      }
    }, rotation.every)
  } else if (!opts) {
    rotation.value = 0
    rotation.every = 0
    clearTimeout(rotation.interval)
    return this
  }

  return this
}

/**
 * Calculates and returns a vertical field of view
 * value in degrees.
 *
 * @public
 * @param {Object} [dimensions] - Optional dimensions overrides.
 * @param {Number} [dimensions.height] - Height dimension.
 * @param {Number} [dimensions.width] - Width dimension.
 * @param {Number} [dimensions.ratio] - Aspect ratio (w/h) dimension.
 * @return {Number}
 */

Axis.prototype.getCalculatedFieldOfView = function (dimensions) {
  console.warn('getCalculatedFieldOfView() is deprecated. ' +
               'The field of view should be set, otherwise' +
               ' the value will be ' + DEFAULT_FOV)
  return DEFAULT_FOV
}
