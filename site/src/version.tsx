import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { VersionPage, type VersionId } from './versions.tsx'
import './site.css'

const root = document.getElementById('root')!

createRoot(root).render(
  <StrictMode>
    <VersionPage id={root.dataset.version as VersionId} />
  </StrictMode>,
)
