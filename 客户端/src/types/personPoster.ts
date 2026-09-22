export type PeopleRecord = {
  row: number
  nickname: string
  event: string
  track: string
  images: string[]
  issues: string[]
}
export type PeopleSheet = { name: string; records: PeopleRecord[]; issues: string[] }
export type PeopleDocument = { sheets: PeopleSheet[] }
