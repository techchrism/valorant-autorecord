import 'dotenv/config'
import OBSWebSocket from 'obs-websocket-js'
import {ValorantAPI} from './ValorantAPI.js'
import {
    LockfileData, MapDataResponse, PregameMatchData, PrivatePresence,
    ValorantChatSessionResponse,
    ValorantEvent,
    ValorantExternalSessionsResponse, ValorantMatchData,
    ValorantWebsocketEvent
} from './valorantTypes'
import {loadConfig} from './config.js'
import {WebSocket} from 'ws'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import Mustache from 'mustache'
import fetch from 'node-fetch'

// @ts-ignore
Mustache.escape! = v => v

interface StopRecordResponse {
    outputPath: string
}

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

const matchCorePrefix = '/riot-messaging-service/v1/message/ares-core-game/core-game/v1/matches/'
const preGamePrefix = '/riot-messaging-service/v1/message/ares-pregame/pregame/v1/matches/'
const gameEndURI = '/riot-messaging-service/v1/message/ares-match-details/match-details/v1/matches'
const clientPlatform = 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9'
const requestDelay = 5 * 1000

async function main() {
    const config = await loadConfig()

    // Try connecting to OBS
    const obs = new OBSWebSocket()
    if(config.obs.enable) {
        await obs.connect(`ws://${config.obs.ip}:${config.obs.port}`, config.obs.password)
    }

    // Set up Valorant API
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

        let gameVersion: string | null = null
        let mapData: MapDataResponse | null = null

        let gameID: string | null = null
        let preGameID: string | null = null
        let previousGameID: string | null = null
        let dataDir: string | null = null
        let websocketEvents: ValorantWebsocketEvent[] = []

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
        ws.on('message', async message => {
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
                        // Game end
                        console.log(`Game ${gameID} ended!`)

                        let outputPath: string | null = null
                        if(config.obs.enable) {
                            const response = (await obs.call('StopRecord')) as unknown as StopRecordResponse
                            outputPath = response.outputPath
                        }

                        if(config.data.enable && dataDir !== null) {
                            await fs.writeFile(path.join(dataDir, 'events.json'), JSON.stringify(websocketEvents), 'utf-8')

                            await asyncTimeout(requestDelay)
                            console.log('Getting match data')
                            const matchData = await val.requestRemotePD<ValorantMatchData>(`match-details/v1/matches/${gameID}`, config.data.region)
                            await fs.writeFile(path.join(dataDir, 'match.json'), JSON.stringify(matchData), 'utf-8')

                            if(outputPath !== null) {
                                if(mapData === null) {
                                    mapData = (await (await fetch('https://valorant-api.com/v1/maps')).json()) as MapDataResponse
                                }
                                let score = ''
                                const ownPlayer = matchData.players.find(player => player.subject === chatSession.puuid)
                                if(ownPlayer !== undefined && matchData.teams !== null) {
                                    const ownScore = matchData.teams.find(team => team.teamId === ownPlayer.teamId)!.numPoints

                                    if(matchData.teams.length === 1) {
                                        score = ownScore.toString()
                                    } else {
                                        const maxScore = matchData.teams.filter(team => team.teamId !== ownPlayer.teamId)
                                            .sort((t1, t2) => t2.numPoints - t1.numPoints)[0].numPoints
                                        score = `${ownScore}-${maxScore}`
                                    }
                                }

                                const extension = path.extname(outputPath)
                                const newPath = Mustache.render(config.obs.renameTemplate, {
                                    directory: path.dirname(outputPath),
                                    extension,
                                    'original-name': path.basename(outputPath, extension),
                                    map: mapData.data.find(map => map.mapUrl === matchData.matchInfo.mapId)?.displayName || '',
                                    queue: matchData.matchInfo.queueID,
                                    score
                                })
                                console.log(`Renaming ${outputPath} to ${newPath}`)
                                await fs.rename(outputPath, newPath)
                            }
                        }
                    }
                    previousGameID = gameID
                    gameID = null
                    preGameID = null
                    dataDir = null
                } else if(data.uri.startsWith(matchCorePrefix)) {
                    if(gameID === null) {
                        const id = data.uri.substring(matchCorePrefix.length);
                        // Another core game ID can be sent after the "match details" message
                        // This check ensures  it's not interpreted as a game start
                        if(id !== previousGameID) {
                            gameID = id

                            // Game start
                            console.log(`Game ${gameID} started!`)

                            if(config.data.enable && dataDir !== null) {
                                await asyncTimeout(15 * 1000)
                                console.log('Getting coregame and loadout data')
                                const coreGameData = await val.requestRemoteGLZ(`core-game/v1/matches/${gameID}`, config.data.region)
                                await fs.writeFile(path.join(dataDir, 'coregame-match.json'), JSON.stringify(coreGameData), 'utf-8')
                                await asyncTimeout(requestDelay)
                                const loadoutsData = await val.requestRemoteGLZ(`core-game/v1/matches/${gameID}/loadouts`, config.data.region)
                                await fs.writeFile(path.join(dataDir, 'loadouts.json'), JSON.stringify(loadoutsData), 'utf-8')
                            }
                        }
                    }
                } else if(data.uri.startsWith(preGamePrefix)) {
                    if(preGameID === null) {
                        preGameID = data.uri.substring(preGamePrefix.length);

                        // Pre-game start
                        console.log(`Pregame ${preGameID} started!`)
                        websocketEvents = []

                        // Start OBS recording
                        if(config.obs.enable) {
                            await obs.call('StartRecord')
                        }

                        if(config.data.enable) {
                            dataDir = path.join(config.data.path, preGameID)
                            await fs.mkdir(dataDir, {recursive: true})

                            // Get pre-game match data
                            console.log('Getting pregame data')
                            const pregameMatchData: PregameMatchData = await val.requestRemoteGLZ(`pregame/v1/matches/${preGameID}`, config.data.region)
                            await fs.writeFile(path.join(dataDir, 'pregame-match.json'), JSON.stringify(pregameMatchData), 'utf-8')

                            // Load game version if not already loaded
                            if(gameVersion === null) {
                                const presences = (await val.getPresences()).presences
                                const ownPresence = presences.find(presence => presence.puuid === chatSession.puuid)
                                if(ownPresence === undefined) {
                                    console.warn('Own presence data was not found')
                                } else {
                                    const privateData = JSON.parse(Buffer.from(ownPresence.private, 'base64').toString('utf-8')) as PrivatePresence
                                    gameVersion = privateData.partyClientVersion
                                }
                            }

                            // MMR and match history
                            const mmrPath = path.join(dataDir, 'mmr')
                            await fs.mkdir(mmrPath)
                            const matchHistoryPath = path.join(dataDir, 'history')
                            await fs.mkdir(matchHistoryPath)

                            for(const team of pregameMatchData.Teams) {
                                for(const player of team.Players) {
                                    console.log(`Getting mmr and match history data ${player.Subject}`)
                                    await asyncTimeout(requestDelay)
                                    const mmrData = await val.requestRemotePD(`mmr/v1/players/${player.Subject}`, config.data.region, {
                                        'X-Riot-ClientPlatform': clientPlatform,
                                        'X-Riot-ClientVersion': gameVersion
                                    })
                                    await fs.writeFile(path.join(mmrPath, `${player.Subject}.json`), JSON.stringify(mmrData), 'utf-8')

                                    await asyncTimeout(requestDelay)
                                    const matchHistoryData = await val.requestRemotePD(`match-history/v1/history/${player.Subject}?endIndex=25`, config.data.region)
                                    await fs.writeFile(path.join(matchHistoryPath, `${player.Subject}.json`), JSON.stringify(matchHistoryData), 'utf-8')
                                }
                            }
                        }
                    }
                }
            }

            // Save to websocket log
            if(preGameID !== null && config.data.enable) {
                websocketEvents.push({event, data})
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
    await main()
})()

