import 'dotenv/config'
import OBSWebSocket from 'obs-websocket-js'
import {ValorantAPI} from './ValorantAPI.js'
import {
    LockfileData, PrivatePresence,
    ValorantChatSessionResponse,
    ValorantEvent,
    ValorantExternalSessionsResponse, ValorantPresenceEvent
} from "./valorantTypes";
import {WebSocket} from 'ws'

async function asyncTimeout(delay: number) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, delay)
    })
}

async function runOBSTest() {
    const obs = new OBSWebSocket()
    await obs.connect(`ws://${process.env['OBS_IP']}:${process.env['OBS_PORT']}`, process.env['OBS_PASSWORD'])
    await obs.call('StartRecord')
    await asyncTimeout(1 * 1000)
    const response = await obs.call('StopRecord')
    console.log(response)
    await obs.disconnect()
}

async function onGameStart() {
    console.log('Game started!')
}

async function onGameEnd(gameID: string) {
    console.log(`Game ended: ${gameID}`)
}

const matchCorePrefix = '/riot-messaging-service/v1/message/ares-core-game/core-game/v1/matches/';

async function main() {
    const val = new ValorantAPI()
    val.on('ready', async (lockfileData: LockfileData,
                           chatSession: ValorantChatSessionResponse,
                           externalSessions: ValorantExternalSessionsResponse) => {
        console.log('Valorant started, waiting for events...')
        const help = await val.getFullHelp()
        console.log(`Loaded ${Object.keys(help.events).length} events, waiting for game...`)

        const ws = new WebSocket(`wss://riot:${lockfileData.password}@127.0.0.1:${lockfileData.port}`, {
            rejectUnauthorized: false
        });

        let wasInGame = false
        let gameID: string | null = null

        ws.on('close', () => {
            console.log('Disconnected from Valorant')
        })
        ws.on('open', () => {
            // Subscribe to all events by name
            Object.entries(help.events).forEach(([name, desc]) => {
                if(name === 'OnJsonApiEvent') return;
                ws.send(JSON.stringify([5, name]));
            });
        })
        ws.on('message', message => {
            let event: string, data: ValorantEvent
            try {
                [, event, data] = JSON.parse(message.toString());
            } catch(e) {
                return;
            }

            if(event === 'OnJsonApiEvent_chat_v4_presences') {
                const presenceEvent = (data as ValorantPresenceEvent)
                const ownPresence = presenceEvent.data.presences.find(presence => presence.pid === chatSession.pid)
                if(ownPresence === undefined) return

                const privateData = JSON.parse(Buffer.from(ownPresence.private, 'base64').toString('utf-8')) as PrivatePresence
                const inGame = privateData.sessionLoopState === 'INGAME'

                if(!inGame && wasInGame) {
                    // Used to be in a game but is no longer in a game
                    wasInGame = false
                    if(gameID === null) {
                        console.warn('Game ended with null ID')
                    } else {
                        onGameEnd(gameID)
                    }
                } else if(inGame && !wasInGame) {
                    // Is now in a game
                    wasInGame = true
                    onGameStart()
                }
            } else if(event === 'OnJsonApiEvent_riot-messaging-service_v1_message') {
                if(data.uri.startsWith(matchCorePrefix)) {
                    gameID = data.uri.substring(matchCorePrefix.length);
                }
            }
        })
    })
    try {
        await val.checkLockfile()
    } catch(ignored) {
        console.log('Waiting for Valorant to start...')
    }
}

(async () => {
    //await runOBSTest()
    await main()
})()

