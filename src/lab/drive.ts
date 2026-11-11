import type { DriveLibrary } from '../drive/library'
import type { LabTransport } from './sync'

export function labTransport(library: DriveLibrary, accountId: string): LabTransport {
  return {
    list: () => library.listLabFiles(accountId, 'labEvents'),
    read: id => library.readLabFile(accountId, id, 'labEvents'),
    append: batch => library.appendLabEvents(accountId, batch),
  }
}
