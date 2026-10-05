import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exportTimeline } from "@openfilm/exporters";
import type { Composition, MediaAsset } from "@openfilm/core";

// Independent parser readback, rather than string matching the exporter itself.
const directory = await mkdtemp(join(tmpdir(), "openfilm-interchange-"));
const assets: MediaAsset[] = [
  {
    id: "video",
    name: "Scene & subject",
    uri: "file:///media/a%20b.mp4",
    mediaType: "video",
    duration: 100,
    tags: [],
    state: {},
    metadata: {},
  },
  {
    id: "audio",
    name: "Sound",
    uri: "file:///media/sound.wav",
    mediaType: "audio",
    duration: 20,
    tags: [],
    state: {},
    metadata: {},
  },
];
const composition: Composition = {
  id: "cut",
  storyId: "story",
  duration: 12,
  tracks: [
    {
      id: "video",
      type: "video",
      clips: [
        {
          id: "clip",
          assetId: "video",
          sourceIn: 5,
          sourceOut: 9,
          timelineStart: 2,
          timelineDuration: 4,
        },
      ],
    },
    {
      id: "audio",
      type: "audio",
      clips: [
        {
          id: "sound",
          assetId: "audio",
          sourceIn: 3,
          sourceOut: 5,
          timelineStart: 1,
          timelineDuration: 2,
        },
      ],
    },
  ],
};
try {
  for (const format of ["otio", "fcpxml"] as const)
    await writeFile(
      join(directory, `timeline.${format}`),
      exportTimeline(format, composition, assets).content,
    );
  const script = String.raw`
import sys, pathlib, fractions, xml.etree.ElementTree as ET
import opentimelineio as otio
root = pathlib.Path(sys.argv[1])
timeline = otio.adapters.read_from_file(str(root / 'timeline.otio'))
assert abs(timeline.duration().to_seconds() - 12) < 1e-8
assert len(timeline.tracks) == 2
for track, offset, source, duration, uri in [(timeline.tracks[0], 2, 5, 4, 'file:///media/a%20b.mp4'), (timeline.tracks[1], 1, 3, 2, 'file:///media/sound.wav')]:
    clips = [item for item in track if isinstance(item, otio.schema.Clip)]
    assert len(clips) == 1
    clip = clips[0]
    assert abs(track.range_of_child(clip).start_time.to_seconds() - offset) < 1e-8
    assert abs(clip.source_range.start_time.to_seconds() - source) < 1e-8
    assert abs(clip.duration().to_seconds() - duration) < 1e-8
    assert clip.media_reference.target_url == uri
# Serialize and deserialize through the official adapter too.
restored = otio.adapters.read_from_string(otio.adapters.write_to_string(timeline, 'otio_json'), 'otio_json')
assert abs(restored.duration().to_seconds() - 12) < 1e-8
xml = ET.parse(root / 'timeline.fcpxml').getroot()
assert xml.tag == 'fcpxml' and xml.attrib['version'] == '1.10'
resources = {element.attrib['id']: element for element in xml.find('resources')}
sequence = xml.find('./library/event/project/sequence')
assert fractions.Fraction(sequence.attrib['duration'][:-1]) == 12
clips = sequence.findall('.//asset-clip')
assert len(clips) == 2
for clip, source, duration, uri in zip(clips, [5, 3], [4, 2], ['file:///media/a%20b.mp4', 'file:///media/sound.wav']):
    assert fractions.Fraction(clip.attrib['start'][:-1]) == source
    assert fractions.Fraction(clip.attrib['duration'][:-1]) == duration
    assert resources[clip.attrib['ref']].find('media-rep').attrib['src'] == uri
assert clips[1].attrib['lane'] == '-1'
assert fractions.Fraction(clips[1].attrib['offset'][:-1]) == 1
print('Official OTIO read/write/read preserved source ranges, offsets and tracks; FCPXML parsed with referenced resources and rational times.')
`;
  const { stdout } = await promisify(execFile)(
    process.env.OPENFILM_OTIO_PYTHON ?? "python3",
    ["-c", script, directory],
  );
  process.stdout.write(stdout);
} finally {
  await rm(directory, { recursive: true, force: true });
}
