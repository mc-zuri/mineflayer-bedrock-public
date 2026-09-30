import net from 'net'
import type { AddressInfo } from 'net'

const getPort = () => new Promise<number>(resolve => {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  server.on('listening', () => {
    const { port } = server.address() as AddressInfo // listening on TCP
    server.close(() => resolve(port))
  })
})

export { getPort }
