const DOWNLOAD_FOLDER_BY_EXTENSION: ReadonlyArray<readonly [string, RegExp]> = [
  ['Compressed', /\.(?:zip|rar|7z|tar|gz|bz2|xz|zst|tgz|tbz2|txz|iso|pkg)$/i],
  ['Music', /\.(?:mp3|m4a|m4b|aac|wav|flac|ogg|opus|wma|aiff|alac)$/i],
  ['Documents', /\.(?:pdf|doc|docx|odt|rtf|txt|md|csv|xls|xlsx|ods|ppt|pptx|odp|epub|mobi)$/i],
  ['Video', /\.(?:mp4|m4v|mkv|mov|avi|webm|wmv|mpg|mpeg|3gp|ts)$/i],
  ['Programs', /\.(?:exe|msi|msp|appx|msix|msixbundle|bat|cmd|ps1|jar)$/i]
]

/** Returns the familiar Downloads subfolder for a recognized file type. */
export function getDownloadCategory(fileName: string): string | undefined {
  return DOWNLOAD_FOLDER_BY_EXTENSION.find(([, extension]) => extension.test(fileName))?.[0]
}
