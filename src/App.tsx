import { useCallback, useEffect, useState } from 'react'

import {
  clearParentSession,
  getAccessTokenExpiration,
  getStoredParentUser,
  onTokenExpired,
} from './parent/api.js'
import { clearMessengerSession } from './messenger/api.js'
import { clearE2EEFileRuntimeCaches } from './messenger/e2ee/files.js'
import { clearE2EEMessageRuntimeCaches } from './messenger/e2ee/messages.js'
import LayoutPage from './parent/pages/jsx/LayoutPage.jsx'
import WelcomePage from './parent/pages/jsx/WelcomePage.jsx'

const LOGGED_IN_HISTORY_KEY = 'parrotLoggedInView'

type ParentUser = {
  username?: string
  email?: string
  account_number?: string
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  profile_picture?: string | null
  [key: string]: unknown
} | null

function getParentUserScope(user: ParentUser) {
  const userId = user?.id || user?.user_id

  if (userId) {
    return `user:${String(userId)}`
  }

  if (user?.account_number) {
    return `account:${String(user.account_number)}`
  }

  if (user?.username) {
    return `username:${String(user.username)}`
  }

  return ''
}

function clearMessengerRuntimeState() {
  clearE2EEMessageRuntimeCaches()
  clearE2EEFileRuntimeCaches()
}

function clearLoggedInHistoryState() {
  const currentState = window.history.state || {}

  if (!currentState[LOGGED_IN_HISTORY_KEY]) {
    return
  }

  const nextState = { ...currentState }
  delete nextState[LOGGED_IN_HISTORY_KEY]
  window.history.replaceState(nextState, '', window.location.href)
}

function App() {
  const [parentUser, setParentUser] = useState<ParentUser>(
    () => getStoredParentUser() as ParentUser,
  )

  const handleLoginSuccess = useCallback((user: ParentUser) => {
    clearMessengerSession()
    clearMessengerRuntimeState()
    clearLoggedInHistoryState()
    setParentUser(user || (getStoredParentUser() as ParentUser))
  }, [])

  const handleLogout = useCallback(() => {
    clearMessengerRuntimeState()
    clearLoggedInHistoryState()
    setParentUser(null)
  }, [])

  const handleUserUpdate = useCallback((user: ParentUser) => {
    setParentUser(user || (getStoredParentUser() as ParentUser))
  }, [])

  const handleSessionExpired = useCallback(() => {
    clearMessengerSession()
    clearMessengerRuntimeState()
    clearLoggedInHistoryState()
    clearParentSession()
    setParentUser(null)
  }, [])

  useEffect(() => {
    if (!parentUser) {
      return undefined
    }

    const unsubscribe = onTokenExpired(handleSessionExpired)
    const expiresAt = getAccessTokenExpiration()

    if (!expiresAt) {
      return unsubscribe
    }

    const delay = expiresAt - Date.now()

    if (delay <= 0) {
      handleSessionExpired()
      return unsubscribe
    }

    const timeoutId = window.setTimeout(handleSessionExpired, delay)

    return () => {
      window.clearTimeout(timeoutId)
      unsubscribe()
    }
  }, [handleSessionExpired, parentUser])

  if (parentUser) {
    const parentUserScope = getParentUserScope(parentUser)

    return (
      <LayoutPage
        key={parentUserScope || 'current-user'}
        user={parentUser}
        onLogout={handleLogout}
        onUserUpdate={handleUserUpdate}
      />
    )
  }

  return <WelcomePage onLoginSuccess={handleLoginSuccess} />
}

export default App
