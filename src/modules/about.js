const client = require('../helpers/client')
const constants = require('../helpers/constants')

module.exports = (name, who) => {
  return new Promise((resolve, reject) => {
    const sbot = client.getClient()

    if (sbot && name && who) {
      sbot.publish({ type: constants.ABOUT, about: who, name }, (err) => {
        if (err) return reject(err)
        resolve()
      })
    }
  })
}
