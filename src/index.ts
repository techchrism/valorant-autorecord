import 'dotenv/config'
import OBSWebSocket from 'obs-websocket-js'

async function asyncTimeout(delay: number) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, delay)
    })
}

(async () => {
    const obs = new OBSWebSocket()
    await obs.connect(`ws://${process.env['OBS_IP']}:${process.env['OBS_PORT']}`, process.env['OBS_PASSWORD'])
    await obs.call('StartRecord')
    await asyncTimeout(10 * 1000)
    await obs.call('StopRecord')
})()

