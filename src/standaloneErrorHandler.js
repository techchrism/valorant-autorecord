// From https://stackoverflow.com/a/49959557
const keypress = async () => {
    process.stdin.setRawMode(true)
    return new Promise(resolve => process.stdin.once('data', () => {
        process.stdin.setRawMode(false)
        resolve()
    }))
}

async function quitWithError(error) {
    console.error('Quitting with error: ', error)
    console.log('Press any key to continue...')
    await keypress()
    process.exit(1)
}

process.on('uncaughtException', quitWithError)
process.on('unhandledRejection', quitWithError)
