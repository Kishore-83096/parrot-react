import { useCallback, useEffect, useState } from 'react'

import {
  clearParentSession,
  getAccessTokenExpiration,
  getStoredParentUser,
  onTokenExpired,
} from './parent/api.js'
import { clearMessengerSession } from './messenger/api.js'
import LayoutPage from './parent/pages/jsx/LayoutPage.jsx'
import WelcomePage from './parent/pages/jsx/WelcomePage.jsx'

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

function App() {
  const [parentUser, setParentUser] = useState<ParentUser>(
    () => getStoredParentUser() as ParentUser,
  )

  const handleLoginSuccess = useCallback((user: ParentUser) => {
    clearMessengerSession()
    setParentUser(user || (getStoredParentUser() as ParentUser))
  }, [])

  const handleLogout = useCallback(() => {
    setParentUser(null)
  }, [])

  const handleUserUpdate = useCallback((user: ParentUser) => {
    setParentUser(user || (getStoredParentUser() as ParentUser))
  }, [])

  const handleSessionExpired = useCallback(() => {
    clearMessengerSession()
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
    return (
      <LayoutPage
        user={parentUser}
        onLogout={handleLogout}
        onUserUpdate={handleUserUpdate}
      />
    )
  }

  return <WelcomePage onLoginSuccess={handleLoginSuccess} />
}

export default App
