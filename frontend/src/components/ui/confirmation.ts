import { createContext, useContext } from 'react'
export type Confirmation = {
  title: string
  description: string
  confirmText?: string
}
export const ConfirmContext = createContext<
  (options: Confirmation) => Promise<boolean>
>(async () => false)
export const useConfirm = () => useContext(ConfirmContext)
