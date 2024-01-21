
export function run<T>(func: () => T): T {
    return func()
}