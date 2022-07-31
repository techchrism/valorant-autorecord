import {promises as fs} from 'node:fs'

export interface Config {
    obs: {
        enable: boolean
        ip: string
        port: number
        password: string
    }
    data: {
        enable: boolean
        path: string
    }
}

const defaultConfig: Config = {
    obs: {
        enable: true,
        ip: '127.0.0.1',
        port: 4455,
        password: ''
    },
    data: {
        enable: true,
        path: ''
    }
}

/**
 * A typeguarded version of `instanceof Error` for NodeJS.
 * @author Joseph JDBar Barron
 * @link https://dev.to/jdbar
 */
export function instanceOfNodeError<T extends new (...args: any) => Error>(
    value: Error,
    errorType: T
): value is InstanceType<T> & NodeJS.ErrnoException {
    return value instanceof errorType;
}

export async function loadConfig(): Promise<Config> {
    const configPath = 'config.json'
    try {
        return JSON.parse(await fs.readFile(configPath, 'utf-8'))
    } catch(e: any) {
        if(instanceOfNodeError(e, Error) && e.code === 'ENOENT') {
            console.log('Creating default config...')
            await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 4))
            return defaultConfig
        } else {
            throw e
        }
    }
}
