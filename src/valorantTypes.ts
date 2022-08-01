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

export interface Presence {
    actor: string
    basic: string
    details: string
    game_name: string
    game_tag: string
    location: string
    msg: string
    name: string
    patchline: string | null
    pid: string
    platform: string | null
    private: string
    privateJwt: string | null
    product: string
    puuid: string
    region: string
    resource: string
    state: string
    summary: string
    time: number
}

export interface PrivatePresence {
    isValid: boolean
    sessionLoopState: string
    partyOwnerSessionLoopState: string
    customGameName: string
    customGameTeam: string
    partyOwnerMatchMap: string
    partyOwnerMatchCurrentTeam: string
    partyOwnerMatchScoreAllyTeam: number
    partyOwnerMatchScoreEnemyTeam: number
    partyOwnerProvisioningFlow: string
    provisioningFlow: string
    matchMap: string
    partyId: string
    isPartyOwner: boolean
    partyState: string
    partyAccessibility: string
    maxPartySize: number
    queueId: string
    partyLFM: boolean
    partyClientVersion: string
    partySize: number
    tournamentId: string
    rosterId: string
    partyVersion: number
    queueEntryTime: string
    playerCardId: string
    playerTitleId: string
    preferredLevelBorderId: string
    accountLevel: number
    competitiveTier: number
    leaderboardPosition: number
    isIdle: boolean
}

export interface ValorantEvent {
    eventType: string
    uri: string
}

export interface ValorantPresenceResponse {
    presences: Presence[]
}

export interface ValorantPresenceEvent extends ValorantEvent {
    data: ValorantPresenceResponse
}

export interface ValorantWebsocketEvent {
    event: string
    data: ValorantEvent
}

// Subset of all data
export interface PregameMatchData {
    ID: string
    Teams: {
        TeamID: string
        Players: {
            Subject: string
        }[]
    }[]
}
