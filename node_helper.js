//
// Module : MMM-Hotword
//

'use strict'

const path = require('path')

const record = require("./components/lpcm16.js")
const B2W = require("./components/b2w.js")
const Detector = require('./snowboy/lib/node/index.js').Detector
const Models = require('./snowboy/lib/node/index.js').Models
const fs = require('fs')
const eos = require('end-of-stream')


var NodeHelper = require("node_helper")

module.exports = NodeHelper.create({
  start: function () {
    console.log("[HOTWORD] MMM-Hotword starts");
    this.config = {}
    this.models = []
    this.mic = null
    this.detector = null
    this.b2w = null
    this.afterRecordingFile = "temp/afterRecording.wav"
    this.detected = null
    this.running = false
  },

  loadRecipes: function(callback=()=>{}) {
    let replacer = (key, value) => {
      if (typeof value == "function") {
        return "__FUNC__" + value.toString()
      }
      return value
    }
    var recipes = this.config.recipes
    for (var i = 0; i < recipes.length; i++) {
      try {
        var p = require("./recipes/" + recipes[i]).recipe
        if (p.hasOwnProperty("models") && Array.isArray(p.models)) {
          this.config.models = [].concat(this.config.models, p.models)
        }
        if (p.hasOwnProperty("customCommands") && typeof p.customCommands == "object") {
          this.config.customCommands = Object.assign({}, this.config.customCommands, p.customCommands)
        }
        this.sendSocketNotification("LOAD_RECIPE", JSON.stringify(p, replacer, 2))
        console.log("[HOTWORD] Recipe is loaded:", recipes[i])
      } catch (e) {
        console.log("[HOTWORD] Recipe error:", e)
      }
    }
    callback()
  },

  initializeAfterLoading: function (config) {
    this.config = config
    this.loadRecipes(()=>{
      this.sendSocketNotification("INITIALIZED")
    })
  },

  socketNotificationReceived: function (notification, payload) {
    switch(notification) {
      case 'INIT':
        this.initializeAfterLoading(payload)
        break
      case 'RESUME':
        if (!this.running) {
          this.activate()
          this.sendSocketNotification('RESUMED')
        } else {
          this.sendSocketNotification('ALREADY_RESUMED')
        }
        break
      case 'PAUSE':
        if (this.running) {
          this.deactivate()
          this.sendSocketNotification('PAUSED')
        } else {
          this.sendSocketNotification('ALREADY_PAUSED')
        }
        break
    }
  },

  activate: function() {
    this.b2w = null
    this.detected = null
    var models = new Models();
    var modelPath = path.resolve(__dirname, "models")
    if (this.config.models.length == 0) {
      console.log("[HOTWORD] No model to load")
      return
    }
    this.config.models.forEach((model)=>{
      model.file = path.resolve(modelPath, model.file)
      models.add(model)
    })
    this.detector = new Detector({
      resource: path.resolve(__dirname, "snowboy/resources/common.res"),
      models: models,
      audioGain: this.config.DetectorAudioGain,
      applyFrontend: this.config.DetectorApplyFrontend
    })
    console.log('[HOTWORD] begins.')
    this.sendSocketNotification("START")
    var silenceTimer = 0
    this.detector
      .on('silence', ()=>{
        this.sendSocketNotification("SILENCE")
        var now = Date.now()
        if (this.b2w !== null) {
          if (now - silenceTimer > this.config.mic.silence * 1000) {
            this.stopListening()
          }
    		}
      })
      .on('sound', (buffer)=>{
        this.sendSocketNotification("SOUND", {size:buffer.length})
        if (this.b2w !== null) {
          silenceTimer = Date.now()
          this.b2w.add(buffer)
          console.log("[HOTWORD] After Recording:", buffer.length)
        }
      })
      .on('error', (err)=>{
        console.log('[HOTWORD] Detector Error', err)
        this.sendSocketNotification("ERROR", {error:err})
        this.stopListening()
        return
      })
      .on('hotword', (index, hotword, buffer)=>{
        silenceTimer = Date.now()
        if (!this.detected) {
          this.b2w = new B2W({
            channel : this.detector.numChannels(),
            sampleRate: this.detector.sampleRate()
          })
        }
        this.detected = (this.detected) ? this.detected + "-" + hotword : hotword
        console.log("[HOTWORD] Detected:", this.detected)
        this.sendSocketNotification("DETECT", {hotword:this.detected})
        return
      })
    this.startListening()
  },

  deactivate: function() {
    this.stopListening()
  },

  stopListening: function() {
    this.running = false
    console.log('[HOTWORD] stops.')
    this.mic.unpipe(this.detector)
    this.mic = null
    var r = record.stop()
  },

  startListening: function () {
    this.running = true
    console.log("[HOTWORD] Detector starts listening.")
    this.mic = record.start(this.config.mic, ()=>{
      console.log("callback!")
      if (this.detected) {
        if (this.b2w !== null) {
          var length = this.b2w.getAudioLength()
          if (length < 8192) {
            console.log("[HOTWORD] After Recording is too short")
            this.b2w.destroy()
            this.b2w = null
            this.finish(this.detected, null)
          } else {
            console.log("[HOTWORD] After Recording finised. size:", length)
            this.b2w.writeFile(path.resolve(__dirname, this.afterRecordingFile), (file)=>{
              this.finish(this.detected, this.afterRecordingFile)
            })
          }
        } else {
          this.finish(this.detected, null)
        }
      } else {
        this.finish()
      }
    })
    this.mic.pipe(this.detector)
/*
    eos(this.detector, (err) => {
      if (err) {
        this.sendSocketNotification("ERROR", {error:err})
      }
      this.stopListening()
    })
*/
  },

  finish: function(hotword = null, file = null) {
    var pl = {}
    if (hotword) {
      pl = {detected:true, hotword:hotword, file:file}
    } else {
      pl = {detected:false}
    }
    this.detected = null
    console.log("FINISH", pl)
    this.sendSocketNotification("FINISH", pl)
  },
})
