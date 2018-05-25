import Vue from 'vue'
import { isFeedId } from 'ssb-ref'
import { format } from 'date-fns'
import { ipcRenderer } from 'electron'
import * as Types from './types'
import * as Constants from '../helpers/constants'
import { compare } from '../helpers/compare'
import { getRandomColor } from '../helpers/randomColor'
import { getAuthorQueue, resetAuthorQueue, pushAuthorQueue } from '../helpers/authorQueue'

export default {
  state: {
    me: '',
    messages: [],
    systemMessage: '',
    authors: {},
    authorColors: {},
    privateMode: false,
    privateRecipients: []
  },
  getters: {
    visibleMessages: state => {
      if (state.privateMode) {
        return state.messages.filter(msg => msg.private && compare(msg.recipients || [], state.privateRecipients))
      }
      return state.messages.filter(msg => !msg.private)
    },
    privateRecipientNames: state => {
      return state.privateRecipients
        .filter(r => r !== state.me)
        .map(r => (state.authors[r] || {}).name || r.slice(0, 7)).join(', ')
    },
    mode: state => state.privateMode ? Constants.MODE.PRIVATE : Constants.MODE.PUBLIC
  },
  mutations: {
    [Types.SET_AUTHOR_COLOR] (state, { author, color }) {
      Vue.set(state.authorColors, author, color)
    },
    [Types.SET_ME] (state, { me }) {
      Vue.set(state, 'me', me)
    },
    [Types.ADD_MESSAGE] (state, { message }) {
      state.messages.push(message)
    },
    [Types.SET_SYSTEM_MESSAGE] (state, { error, message }) {
      Vue.set(state, 'systemMessage', { error, message })
    },
    [Types.SET_PRIVATE_MODE] (state, { privateMode }) {
      Vue.set(state, 'privateMode', privateMode)
    },
    [Types.SET_PRIVATE_RECIPIENTS] (state, { recipients }) {
      Vue.set(state, 'privateRecipients', recipients)
    },
    [Types.SET_AUTHORS] (state, { authors }) {
      authors.forEach(({ author, name, setter }) => {
        Vue.set(state.authors, author, { name, setter })
      })
    }
  },
  actions: {
    [Types.SET_ME] ({ commit }, { me }) {
      commit(Types.SET_ME, { me })
      commit(Types.SET_AUTHOR_COLOR, { author: me, color: Constants.ME_GREEN })
    },
    [Types.ADD_MESSAGE] ({ state, commit, dispatch, getters }, { message }) {
      const msg = message.value
      if (msg && msg.content) {
        switch (msg.content.type) {
          case Constants.ABOUT: {
            if (msg.content.about && msg.content.name) {
              // only honor self-identification or my own identification of someone else
              if (msg.author === msg.content.about || msg.author === state.me) {
                let author = msg.content.about
                let cleanName = msg.content.name
                let setter = msg.author
                if (cleanName[0] !== '@') {
                  cleanName = `@${cleanName}`
                }
                const alreadySet = state.authors[author]
                // if we already have this author set
                // and it was already set by the author itself
                // and we are trying to set it ourselves
                // make that happen
                if (alreadySet && alreadySet.setter === author && author !== setter) {
                  pushAuthorQueue({ author, name: cleanName, setter })
                  return
                }
                // if any of that wasn't true, go ahead and set it
                pushAuthorQueue({ author, name: cleanName, setter })
              }
            }
            break
          }
          case Constants.MESSAGE_TYPE: {
            console.log(msg)
            let authorColor
            if (!state.authorColors[msg.author]) {
              authorColor = getRandomColor()
              commit(Types.SET_AUTHOR_COLOR, { author: msg.author, color: authorColor })
            } else {
              authorColor = state.authorColors[msg.author]
            }
            const formattedMessage = {
              timestamp: format(msg.timestamp, Constants.TIME_FORMAT),
              author: msg.author,
              text: msg.content.text,
              authorColor: authorColor,
              private: msg.private,
              recipients: msg.content.recps || msg.content.recipients
            }
            commit(Types.ADD_MESSAGE, { message: formattedMessage })
            break
          }
          default:
            console.log(msg)
            break
        }
      }
    },
    [Types.SET_SYSTEM_MESSAGE] ({ commit }, { message }) {
      commit(Types.SET_SYSTEM_MESSAGE, { message })
    },
    [Types.SET_ERROR_MESSAGE] ({ commit }, { message }) {
      commit(Types.SET_SYSTEM_MESSAGE, { error: true, message })
    },
    [Types.SET_PRIVATE_MODE] ({ commit, dispatch }, { privateMode }) {
      // when private mode is set or unset, clear system notifications
      dispatch(Types.SET_SYSTEM_MESSAGE, { message: '' })

      if (!privateMode) {
        // if we are going public, clear private recipients
        dispatch(Types.SET_PRIVATE_RECIPIENTS, { recipients: [] })
      }
      commit(Types.SET_PRIVATE_MODE, { privateMode })
    },
    [Types.SET_PRIVATE_RECIPIENTS] ({ commit, state, dispatch }, { recipients }) {
      if (!recipients.length) {
        // empty recipients, clear state
        commit(Types.SET_PRIVATE_RECIPIENTS, { recipients })
        return
      }
      // if these are names, we need to turn them into ids
      const authorIds = Object.keys(state.authors)
      const recipientIds = recipients.map(r => {
        if (!isFeedId(r)) {
          return authorIds.find(
            author => (authorIds[author] || {}).name === r || (authorIds[author] || {}).name === `@${r}`
          ) || r
        }
        return r
      })

      // add me
      if (!recipientIds.includes(state.me)) {
        recipientIds.push(state.me)
      }

      // we won't enter private mode if any recipients are invalid
      if (!recipientIds.every(r => isFeedId(r))) {
        dispatch(Types.SET_SYSTEM_MESSAGE, { message: Constants.PRIVATE_RECIPIENTS_INVALID })
        return
      }
      commit(Types.SET_PRIVATE_RECIPIENTS, { recipients: recipientIds })
      dispatch(Types.SET_PRIVATE_MODE, { privateMode: true })
    },
    [Types.SET_AUTHORS] ({ commit }) {
      commit(Types.SET_AUTHORS, { authors: getAuthorQueue() })
      resetAuthorQueue()
    },
    [Types.RUN_COMMAND] ({ state, commit, dispatch }, { text }) {
      const line = text.split(' ')
      const command = line[0]
      switch (command) {
        case '/whoami': {
          ipcRenderer.send(Constants.SBOT_COMMAND, {
            command: Constants.WHOAMI
          })
          break
        }
        case '/private': {
          // /private @pete @joel
          const recipients = line.slice(1)
          dispatch(Types.SET_PRIVATE_RECIPIENTS, { recipients })
          break
        }
        case '/q':
        case '/quit': {
          // quit removes me from private mode
          dispatch(Types.SET_PRIVATE_MODE, { privateMode: false })
          break
        }
        case '/join':
        case '/pub': {
          // join a pub
          const inviteCode = line[1]
          ipcRenderer.send(Constants.SBOT_COMMAND, {
            command: Constants.JOIN_PUB,
            inviteCode
          })
          break
        }
        case '/name':
        case '/nick': {
          // identify self
          const name = line.slice(1)
          ipcRenderer.send(Constants.SBOT_COMMAND, {
            command: Constants.SET_MY_NAME,
            who: state.me,
            name
          })
          break
        }
        default:
          // TODO handle something about invalid commands here
          break
      }
    },
    [Types.SEND_MESSAGE] ({ state, dispatch }, { text }) {
      // check for commands first
      if (text[0] === '/') {
        dispatch(Types.RUN_COMMAND, { text })
        return
      }
      if (state.privateMode) {
        // handle private sending to private recipients
        ipcRenderer.send(Constants.SBOT_COMMAND, {
          command: Constants.SEND_PRIVATE,
          recipients: state.privateRecipients,
          text
        })
        return
      }
      // sending a public message
      ipcRenderer.send(Constants.SBOT_COMMAND, {
        command: Constants.SEND_PUBLIC,
        text
      })
    }
  }
}
