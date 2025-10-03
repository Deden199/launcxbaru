const WIB_TIME_ZONE = 'Asia/Jakarta'

const wibDateTimeFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: WIB_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'medium',
  hour12: false,
})

export const formatDateTimeInWIB = (value: string | number | Date | null | undefined) => {
  if (value == null) {
    return '—'
  }

  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return `${wibDateTimeFormatter.format(date)} WIB`
}

export const WIB_TIMEZONE_NAME = WIB_TIME_ZONE
