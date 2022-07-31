import 'dotenv/config'
import OBSWebSocket from 'obs-websocket-js'
import {ValorantAPI} from './ValorantAPI.js'
import {LockfileData, ValorantChatSessionResponse, ValorantEvent, ValorantExternalSessionsResponse} from './valorantTypes'
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

async function onPreGameStart(preGameID: string) {
    console.log(`Pregame started: ${preGameID}`)
}

async function onGameStart(gameID: string) {
    console.log(`Game started: ${gameID}`)
}

async function onGameEnd(gameID: string) {
    console.log(`Game ended: ${gameID}`)
}

const matchCorePrefix = '/riot-messaging-service/v1/message/ares-core-game/core-game/v1/matches/'
const preGamePrefix = '/riot-messaging-service/v1/message/ares-pregame/pregame/v1/matches/'
const gameEndURI = '/riot-messaging-service/v1/message/ares-match-details/match-details/v1/matches'

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

        let gameID: string | null = null
        let preGameID: string | null = null
        let previousGameID: string | null = null

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

            if(event === 'OnJsonApiEvent_riot-messaging-service_v1_message') {
                if(data.uri === gameEndURI) {
                    if(gameID === null) {
                        console.warn('Game ended with null ID')
                    } else {
                        onGameEnd(gameID)
                    }
                    previousGameID = gameID
                    gameID = null
                    preGameID = null
                } else if(data.uri.startsWith(matchCorePrefix)) {
                    if(gameID === null) {
                        const id = data.uri.substring(matchCorePrefix.length);
                        if(id !== previousGameID) {
                            gameID = id
                            onGameStart(gameID)
                        }
                    }
                } else if(data.uri.startsWith(preGamePrefix)) {
                    if(preGameID === null) {
                        preGameID = data.uri.substring(matchCorePrefix.length);
                        onPreGameStart(preGameID)
                    }
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

