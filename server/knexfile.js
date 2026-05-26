import config from './config/index.js'

export default {
  ...config.db,
  migrations: {
    directory: './server/migrations'
  },
  seeds: {
    directory: './server/seeds'
  }
}
