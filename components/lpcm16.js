/*
 * Original from https://github.com/gillesdemey/node-record-lpcm16
 */


'use strict'

var spawn = require('child_process').spawn

var cp // Recording process

// returns a Readable stream
exports.start = function (options, cb=()=>{}) {
  cp = null // Empty out possibly dead recording process

  var defaults = {
    sampleRate: 16000,
    channels: 1,
    compress: false,
    threshold: 0.5,
    thresholdStart: null,
    thresholdEnd: null,
    silence: '1.0',
    verbose: false,
    recordProgram: 'rec'
  }

  options = Object.assign(defaults, options)

  // Capture audio stream
  var cmd, cmdArgs, cmdOptions
  switch (options.recordProgram) {
    // On some Windows machines, sox is installed using the "sox" binary
    // instead of "rec"
    case 'sox':
      var cmd = 'sox';
      var cmdArgs = [
        '-q',                     // show no progress
        '-t', 'waveaudio',        // audio type
        '-d',                     // use default recording device
        '-r', options.sampleRate, // sample rate
        '-c', options.channels,   // channels
        '-e', 'signed-integer',   // sample encoding
        '-b', '16',               // precision (bits)
        '-',                      // pipe
        // end on silence
        'silence', '1', '0.1', options.thresholdStart || options.threshold + '%',
        '1', options.silence, options.thresholdEnd || options.threshold + '%'
      ];
      break
    case 'rec':
    default:
      cmd = options.recordProgram
      cmdArgs = [
        '-q',                     // show no progress
        '-r', options.sampleRate, // sample rate
        '-c', options.channels,   // channels
        '-e', 'signed-integer',   // sample encoding
        '-b', '16',               // precision (bits)
        '-t', 'wav',              // audio type
        '-',                      // pipe
         //end on silence
        'silence', '1', '0.1', options.thresholdStart || options.threshold + '%',
        '1', options.silence, options.thresholdEnd || options.threshold + '%'
      ]
      break
    // On some systems (RasPi), arecord is the prefered recording binary
    case 'arecord':
      cmd = 'arecord'
      cmdArgs = [
        '-q',                     // show no progress
        '-r', options.sampleRate, // sample rate
        '-c', options.channels,   // channels
        '-t', 'wav',              // audio type
        '-f', 'S16_LE',           // Sample format
        '-'                       // pipe
      ]
      if (options.device) {
        cmdArgs.unshift('-D', options.device)
      }
      break
    case 'parec':
      cmd = 'parec'
      cmdArgs = [
        '--rate', options.sampleRate,   // sample rate
        '--channels', options.channels, // channels
        '--format', 's16le',            // sample format
      ]
      if (options.device) {
        cmdArgs.unshift('--device', options.device)
      }
      break
  }

  // Spawn audio capture command
  cmdOptions = { encoding: 'binary', shell: true}
  if (options.device) {
    cmdOptions.env = Object.assign({}, process.env, { AUDIODEV: options.device })
  }
  cp = spawn(cmd, cmdArgs, cmdOptions)
  var rec = cp.stdout

  if (options.verbose) {
    console.log('[LPCM16] Recording', options.channels, 'channels with sample rate',
        options.sampleRate)
    console.time('[LPCM16] End Recording')

    rec.on('data', function (data) {
      console.log('[LPCM16] Recording %d bytes', data.length)
    })

    rec.on('end', function () {
      console.timeEnd('[LPCM16] End Recording')
      cb()
    })
  }
  return rec
}

exports.stop = function () {
  if (!cp) {
    console.log('[LPCM16] STOP is called without STARTING')
    return false
  }

  cp.kill() // Exit the spawned process, exit gracefully
  return cp
}
