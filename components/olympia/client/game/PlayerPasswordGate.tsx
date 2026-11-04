import type { LiveSessionRow } from '@/types/olympia/game'
import { PlayerPasswordGateClient } from '@/components/olympia/client/game/PlayerPasswordGateClient'

type PlayerPasswordGateProps = {
  session: LiveSessionRow
  userAlreadyVerified?: boolean
  children: React.ReactNode
}

export function PlayerPasswordGate({ session, userAlreadyVerified = false, children }: PlayerPasswordGateProps) {
  return (
    <PlayerPasswordGateClient
      session={session}
      userAlreadyVerified={userAlreadyVerified}
    >
      {children}
    </PlayerPasswordGateClient>
  )
}
