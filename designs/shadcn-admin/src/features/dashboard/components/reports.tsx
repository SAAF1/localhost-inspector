import { Reports as CombinedReport } from './conversion-retention'
import { Reports as BriefReport } from './brief'
import { Reports as FunnelReport } from './funnel'
import { Reports as SegmentsReport } from './segments'
import { Reports as LibraryReport } from './library'
import { Reports as SchedulesReport } from './schedules'

export function Reports() {
  switch (new URLSearchParams(window.location.search).get('study')) {
    case 'brief': return <BriefReport />
    case 'funnel': return <FunnelReport />
    case 'segments': return <SegmentsReport />
    case 'library': return <LibraryReport />
    case 'schedules': return <SchedulesReport />
    default: return <CombinedReport />
  }
}
