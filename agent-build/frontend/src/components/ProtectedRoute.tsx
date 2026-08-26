import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { authStore } from '@/store/auth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [authed, setAuthed] = useState<boolean>(authStore.isAuthenticated())

  useEffect(() => {
    return authStore.subscribe(() => {
      setAuthed(authStore.isAuthenticated())
    })
  }, [])

  if (!authed) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <>{children}</>
}
