import { EventEmitter as EE } from 'ee-ts'
import fs, { FSWatcher } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import fetch from 'node-fetch'
import https from 'node:https'
import {clearTimeout} from "timers";
import {
    LockfileData, PrivatePresence,
    ValorantChatSessionResponse,
    ValorantExternalSessionsResponse,
    ValorantHelpResponse, ValorantPresenceResponse
} from './valorantTypes'
import {ValorantCredentialManager} from "./ValorantCredentialManager.js";
import {Tail} from 'tail'
import {run} from './util/run.js'

export interface ValorantAPIEvents {
    ready(lockfileData: LockfileData,
          chatSession: ValorantChatSessionResponse,
          externalSessions: ValorantExternalSessionsResponse): void
}

export interface ValorantInitCollectedData {
    version: {
        ciServerVersion: string
        branch: string
        changelist: number
        buildVersion: number
    }
    puuid: string
    region: string
    shard: string
}

const localInitializationLogLineEnding = 'LogPlatformInitializerV2: Status is now: Initialized'
const ciServerVersionRegex = /LogShooter: Display: CI server version: (?<version>.+)/
const branchRegex = /LogShooter: Display: Branch: (?<branch>.+)/
const changeListRegex = /LogShooter: Display: Changelist: (?<changelist>.+)/
const buildVersionRegex = /LogShooter: Display: Build version: (?<buildVersion>.+)/
const sessionAPICallRegex = /\[GET https:\/\/glz-(?<region>.+?)-1.(?<shard>.+?).a.pvp.net\/session\/v1\/sessions\/(?<puuid>.+?)\/reconnect]/

const localAgent = new https.Agent({
    rejectUnauthorized: false
})

/**
 * Performs a local Valorant API request and interprets the response
 * @param lockfileData The loaded lockfile data
 * @param path HTTP path preceding the IP and port
 * @param signal Optional abortion signal
 */
async function getLocalAPI<T>(lockfileData: LockfileData, path: string, signal?: AbortSignal): Promise<T> {
    return (await (await fetch(`https://127.0.0.1:${lockfileData.port}/${path}`, {
        headers: {
            'Authorization': 'Basic ' + Buffer.from(`riot:${lockfileData.password}`).toString('base64')
        },
        agent: localAgent,
        signal
    })).json() as T)
}

/**
 * Loads lockfile data from disk
 * @param lockfilePath The location the Valorant lockfile is kept
 * @param signal Optional signal to abort
 */
async function getLockfileData(lockfilePath: string, signal?: AbortSignal): Promise<LockfileData> {
    const contents = await fs.promises.readFile(lockfilePath, {encoding: 'utf8', signal})
    const split = contents.split(':')
    return {
        name: split[0],
        pid: parseInt(split[1]),
        port: parseInt(split[2]),
        password: split[3],
        protocol: split[4]
    }
}

/**
 * A function to resolve after a certain amount of time or reject if an optional signal was aborted
 * @param timeout The amount of time in milliseconds to wait for a resolve
 * @param signal Optional abortion signal that rejects the promise
 */
async function awaitTimeout(timeout: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if(signal !== undefined) {
            if(signal.aborted) return reject(signal.reason)

            const abortionListener = () => {
                clearTimeout(timeoutID)
                reject(signal.reason)
            }
            const timeoutListener = () => {
                signal.removeEventListener('abort', abortionListener)
                return resolve()
            }
            signal.addEventListener('abort', abortionListener)
            const timeoutID = setTimeout(timeoutListener, timeout)
        } else {
            setTimeout(resolve, timeout)
        }
    })
}

export class ValorantAPI extends EE<ValorantAPIEvents> {
    private watcher: FSWatcher
    private readonly lockfilePath: string
    private connectionAbort?: AbortController
    private lockfileData: LockfileData | undefined
    private credentialManager: ValorantCredentialManager | undefined

    constructor() {
        super()

        this.lockfilePath = path.join(process.env['LOCALAPPDATA']!, 'Riot Games\\Riot Client\\Config\\lockfile');
        this.watcher = fs.watch(path.dirname(this.lockfilePath), async (eventType, fileName) => {
            if (eventType === 'rename' && fileName === 'lockfile') {
                try {
                    await this.checkLockfile()
                } catch(ignored) {}
            }
        });
    }

    /**
     * Tries to connect to Valorant and aborts any existing attempts
     */
    async checkLockfile() {
        if(this.connectionAbort !== undefined) {
            this.connectionAbort.abort()
            this.connectionAbort = undefined
        }
        this.connectionAbort = new AbortController()
        const data = await this.tryConnect(this.connectionAbort.signal)
        this.emit('ready', this.lockfileData!, data.chatSession, data.sessions);
        return data
    }

    /**
     * Tries to connect to Valorant and initiate communication
     * @param signal Optional abort signal
     */
    async tryConnect(signal?: AbortSignal): Promise<{ sessions: ValorantExternalSessionsResponse; chatSession: ValorantChatSessionResponse }> {
        const lockfileData = await getLockfileData(this.lockfilePath, signal)

        if(lockfileData.name !== 'Riot Client') {
            throw new Error(`Invalid lockfile name: ${lockfileData.name}`)
        }

        // If we have a valid name, keep trying to reconnect
        while(true) {
            try {
                const chatSession = await getLocalAPI<ValorantChatSessionResponse>(lockfileData, 'chat/v1/session', signal);
                if(!chatSession.puuid) {
                    throw new Error('No puuid in chat session')
                }
                const sessions = await getLocalAPI<ValorantExternalSessionsResponse>(lockfileData, 'product-session/v1/external-sessions', signal)
                if(Object.keys(sessions).length === 0) {
                    throw new Error('No keys on session data')
                }

                this.lockfileData = lockfileData
                this.credentialManager = new ValorantCredentialManager(lockfileData)
                return {chatSession, sessions}
            } catch(e) {
                if(signal?.aborted) {
                    throw new Error('Signal aborted')
                }
                await awaitTimeout(2000, signal)
            }
        }
    }

    async waitForPrivatePresence(puuid: string, signal?: AbortSignal): Promise<PrivatePresence> {
        if(this.lockfileData === undefined) throw new Error('Lockfile not ready')
        while(true) {
            try {
                const data = await getLocalAPI<ValorantPresenceResponse>(this.lockfileData, 'chat/v4/presences', signal)
                const presence = data.presences.find(p => p.puuid === puuid)
                if(presence !== undefined) {
                    return JSON.parse(Buffer.from(presence.private, 'base64').toString());
                }
            } catch(ignored) {}

            await awaitTimeout(1000, signal)
        }
    }

    /**
     * Waits for the game to be initialized
     * Called when local is ready
     * Adapted from https://github.com/techchrism/valorant-api/blob/31399e5acefa1d9ce0432e713bb2495bcf5c507b/src/ValorantAPI.ts#L131
     * @param readLog Whether to read the log file or not. Should be false when the lockfile is "fresh" because the lockfile is updated before the previous log is cleared
     * @param signal Optional abort signal. Used for aborting the initiation wait when local becomes unready
     */
    async waitForInit(readLog: boolean, signal?: AbortSignal): Promise<ValorantInitCollectedData> {
        if(signal?.aborted) throw new Error('Aborted')
        if(this.lockfileData === undefined) throw new Error('Lockfile not ready')

        return new Promise(async (resolve, reject) => {
            let ciServerVersion: string | undefined = undefined
            let branch: string | undefined = undefined
            let changelist: number | undefined = undefined
            let buildVersion: number | undefined = undefined

            let shard: string | undefined = undefined
            let region: string | undefined = undefined
            let puuid: string | undefined = undefined

            const logTail = new Tail(path.join(process.env['LOCALAPPDATA']!, '/VALORANT/Saved/Logs/ShooterGame.log'), {
                useWatchFile: true,
                fsWatchOptions: {
                    interval: 250
                }
            })

            const localInitializationLogListener = (line: string) => {
                if(line.endsWith(localInitializationLogLineEnding)) {
                    const initData = {
                        version: {
                            ciServerVersion: ciServerVersion || '',
                            branch: branch || '',
                            changelist: changelist || -1,
                            buildVersion: buildVersion || -1
                        },
                        shard: shard || '',
                        region: region || '',
                        puuid: puuid || ''
                    }

                    logTail.unwatch()
                    signal?.removeEventListener('abort', abortHandler)
                    resolve(initData)
                    return
                }

                if(ciServerVersion === undefined) {
                    const match = ciServerVersionRegex.exec(line)
                    if(match) {
                        ciServerVersion = match.groups?.version || ''
                        return
                    }
                }

                if(branch === undefined) {
                    const match = branchRegex.exec(line)
                    if(match) {
                        branch = match.groups?.branch || ''
                        return
                    }
                }

                if(changelist === undefined) {
                    const match = changeListRegex.exec(line)
                    if(match) {
                        changelist = Number(match.groups?.changelist)
                        return
                    }
                }

                if(buildVersion === undefined) {
                    const match = buildVersionRegex.exec(line)
                    if(match) {
                        buildVersion = Number(match.groups?.buildVersion)
                        return
                    }
                }

                if(shard === undefined) {
                    const match = sessionAPICallRegex.exec(line)
                    if(match) {
                        shard = match.groups?.shard || ''
                        region = match.groups?.region || ''
                        puuid = match.groups?.puuid || ''
                        return
                    }
                }
            }
            const abortHandler = () => {
                logTail.unwatch()
                reject(new Error('Aborted'))
            }

            // Next, start watching the log and wait for confirmation
            logTail.on('line', localInitializationLogListener)
            signal?.addEventListener('abort', abortHandler)

            // The promise will already be rejected from the abort handler if the signal was aborted
            if(signal?.aborted) return

            // Finally, request the log in full
            if(readLog) {
                const logData = await fs.promises.readFile(path.join(process.env['LOCALAPPDATA']!, '/VALORANT/Saved/Logs/ShooterGame.log'), 'utf-8')
                if(signal?.aborted) return
                const lines = logData.split(/\r?\n/)
                const lastNonEmptyLine = run(() => {
                    for(let i = lines.length - 1; i >= 0; i--) {
                        if(lines[i].length > 0) return lines[i]
                    }
                    return undefined
                })

                // Check for a stale log from a previous launch (last non-empty line includes "Log file closed")
                if(!(lastNonEmptyLine !== undefined && lastNonEmptyLine.includes('Log file closed'))) {
                    // Not stale
                    for(const line of lines) {
                        localInitializationLogListener(line)
                    }
                }
            }
        })
    }

    async getHelp(signal?: AbortSignal): Promise<ValorantHelpResponse> {
        if(this.lockfileData === undefined) throw new Error('Lockfile not ready')
        return await getLocalAPI<ValorantHelpResponse>(this.lockfileData, 'help', signal)
    }

    /**
     * Get a list of presence data
     */
    async getPresences(): Promise<ValorantPresenceResponse> {
        if(this.lockfileData === undefined) throw new Error('Lockfile not ready')
        return getLocalAPI(this.lockfileData, 'chat/v4/presences')
    }

    private async requestWithAuth<T>(path: string, extraHeaders: object = {}): Promise<T> {
        if(this.credentialManager === undefined) {
            throw new Error('Credential manager not available')
        }
        const creds = await this.credentialManager.getCredentials()
        return (await (await fetch(path, {
            headers: {
                'Authorization': 'Bearer ' + creds.token,
                'X-Riot-Entitlements-JWT': creds.entitlement,
                ...extraHeaders
            }
        })).json() as T)
    }

    /**
     * Makes an API request to a "glz" endpoint. Requires lockfile data to populate credentials
     * @param path The path to request
     * @param region Region for the endpoint domain
     * @param shard Shard for the endpoint domain
     * @param extraHeaders Object with extra headers to add to the request
     */
    async requestRemoteGLZ<T>(path: string, region: string, shard: string, extraHeaders: object = {}): Promise<T> {
        return this.requestWithAuth(`https://glz-${region}-1.${shard}.a.pvp.net/${path}`, extraHeaders)
    }

    /**
     * Makes an API request to a "pd" endpoint. Requires lockfile data to populate credentials
     * @param path The path to request
     * @param shard Shard for the endpoint domain
     * @param extraHeaders Object with extra headers to add to the request
     */
    async requestRemotePD<T>(path: string, shard: string, extraHeaders: object = {}): Promise<T> {
        return this.requestWithAuth(`https://pd.${shard}.a.pvp.net/${path}`, extraHeaders)
    }
}
