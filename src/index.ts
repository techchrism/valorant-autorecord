import 'dotenv/config'
import OBSWebSocket from 'obs-websocket-js'
import {ValorantAPI} from './ValorantAPI.js'
import {LockfileData, ValorantChatSessionResponse, ValorantExternalSessionsResponse} from "./valorantTypes";

async function asyncTimeout(delay: number) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, delay)
    })
}

async function runOBSTest() {
    const obs = new OBSWebSocket()
    await obs.connect(`ws://${process.env['OBS_IP']}:${process.env['OBS_PORT']}`, process.env['OBS_PASSWORD'])
    await obs.call('StartRecord')
    await asyncTimeout(10 * 1000)
    await obs.call('StopRecord')
    await obs.disconnect()
}

(async () => {
    const val = new ValorantAPI()
    val.on('ready', async (lockfileData: LockfileData,
                           chatSession: ValorantChatSessionResponse,
                           externalSessions: ValorantExternalSessionsResponse) => {
        console.log(`Game is now ready! ${chatSession.game_name}#${chatSession.game_tag}`)
        const help = await val.getFullHelp()
        console.log(`Loaded ${Object.keys(help.events).length} events`)
    })
    try {
        await val.checkLockfile()
    } catch(ignored) {}
})()

