import {LockfileData} from "./valorantTypes";
import fetch from "node-fetch";
import https from "node:https";

interface ValorantEntitlementsTokenResponse {
    accessToken: string
    issuer: string
    subject: string
    token: string
}

interface ValorantJWTPayload {
    cid: string
    clm: string[]
    dat: {
        c: string
        lid: string
    }
    exp: number
    iat: number
    iss: string
    jti: string
    scp: string[]
    sub: string
}

export interface ValorantCredentials {
    token: string
    entitlement: string
}

const localAgent = new https.Agent({
    rejectUnauthorized: false
})

// Subtracts this amount from expiration to avoid requesting resources with an about-to-expire cred
const expirationDiff = 60 * 1000

export class ValorantCredentialManager {
    private credentials: ValorantCredentials | null = null
    private expiration: number = -1
    private lockfileData: LockfileData

    constructor(lockfileData: LockfileData) {
        this.lockfileData = lockfileData
    }

    async getCredentials(): Promise<ValorantCredentials> {
        const now = Date.now()
        if(this.credentials === null || now > this.expiration) {
            await this.generateNewCredentials()
        }

        if(this.credentials === null) {
            throw new Error('Invalid credentials')
        }
        return this.credentials
    }

    private async generateNewCredentials() {
        console.log('Generating new credentials...')
        const data = (await (await fetch(`https://127.0.0.1:${this.lockfileData.port}/entitlements/v1/token`, {
            headers: {
                'Authorization': 'Basic ' + Buffer.from(`riot:${this.lockfileData.password}`).toString('base64')
            },
            agent: localAgent
        })).json() as ValorantEntitlementsTokenResponse)

        const jwtPayload = (JSON.parse(
            Buffer.from(data.accessToken.split('.')[1], 'base64').toString('utf-8')
        ) as ValorantJWTPayload)

        this.credentials = {
            token: data.accessToken,
            entitlement: data.token
        }
        this.expiration = (jwtPayload.exp * 1000) - expirationDiff
    }
}
