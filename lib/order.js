// insertBefore over an id list; mirrors WorkspaceRegistry.insertBefore.
export class OrderMoveInvalidError extends Error {
  constructor(id) {
    super('order move: unknown id ' + String(id))
    this.name = 'OrderMoveInvalidError'
    this.id = id
  }
}

export function insertBefore(ids, id, beforeId) {
  const list = Array.isArray(ids) ? ids.slice() : []
  const from = list.indexOf(id)
  if (from < 0) throw new OrderMoveInvalidError(id)
  if (beforeId !== undefined && beforeId !== null && beforeId !== '' && list.indexOf(beforeId) < 0) {
    throw new OrderMoveInvalidError(beforeId)
  }
  list.splice(from, 1)
  if (beforeId === undefined || beforeId === null || beforeId === '') {
    list.push(id)
    return list
  }
  const at = list.indexOf(beforeId)
  list.splice(at, 0, id)
  return list
}