/* Release highlights displayed on the Plexo download page. Keep newest releases first. */
;(function (root) {
  'use strict'

  root.PlexoChangelog = [
    {
      version: 'v2.0.1',
      items: [
        {
          kind: 'improved',
          title: 'Choose download and temporary data folders',
          text: 'Review and change the final save location and temporary transfer-data folder before starting each download.'
        }
      ]
    },
    {
      version: 'v2.0.0',
      items: [
        {
          kind: 'new',
          title: 'Download history',
          text: 'Search and filter completed and unfinished transfers, open finished files directly, and review each download’s speed details.'
        },
        {
          kind: 'new',
          title: 'Internet and combined-network speed tests',
          text: 'Measure internet performance or test selected network adapters together, with selectable test duration.'
        },
        {
          kind: 'new',
          title: 'Sequential batches and scheduling',
          text: 'Queue multiple download links to run in order, cancel waiting items, and set an optional start time.'
        },
        {
          kind: 'improved',
          title: 'Refined Windows experience',
          text: 'Updated app identity, window layouts, browser handoff, and installer publisher metadata.'
        }
      ]
    }
  ]
})(typeof window !== 'undefined' ? window : module.exports)
