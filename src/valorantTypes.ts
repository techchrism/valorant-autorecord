export interface LockfileData {
    name: string
    pid: number
    port: number
    password: string
    protocol: string
}

export interface ValorantHelpResponse {
    events: {[key: string]: string}
    functions: {[key: string]: string}
    types: {[key: string]: string}
}

interface ExternalSession {
    exitCode: number
    exitReason: string | null
    isInternal: boolean
    launchConfiguration: {
        arguments: string[]
        executable: string
        locale: string
        voiceLocale: string | null
        workingDirectory: string
    }
    patchlineFullName: string
    patchlineId: string
    phase: string
    productId: string
    version: string
}

export interface ValorantExternalSessionsResponse {
    [key: string]: ExternalSession
}

export interface ValorantChatSessionResponse {
    federated: boolean
    game_name: string
    game_tag: string
    loaded: boolean
    name: string
    pid: string
    puuid: string
    region: string
    resource: string
    state: string
}
