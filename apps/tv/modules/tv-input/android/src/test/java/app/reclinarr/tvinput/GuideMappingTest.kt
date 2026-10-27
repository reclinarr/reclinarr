package app.reclinarr.tvinput

import org.junit.Assert.assertEquals
import org.junit.Test

class GuideMappingTest {
  private fun channel(uuid: String, number: Double? = null, tvgId: String? = null, logo: String? = null) =
    ApiChannel(uuid, "Channel $uuid", number, logo, tvgId)

  private fun programme(channelId: String, start: Long, end: Long, channelUuid: String? = null, title: String = "Show") =
    ApiProgramme(channelId, channelUuid, title, null, start, end)

  @Test
  fun parsesZuluAndOffsetTimestamps() {
    assertEquals(1_761_588_000_000L, GuideMapping.parseIsoMillis("2025-10-27T18:00:00Z"))
    assertEquals(1_761_588_000_000L, GuideMapping.parseIsoMillis("2025-10-27T19:00:00+01:00"))
    assertEquals(1_761_588_000_500L, GuideMapping.parseIsoMillis("2025-10-27T18:00:00.5Z"))
  }

  @Test
  fun formatsWholeAndDecimalNumbers() {
    assertEquals("7", GuideMapping.formatNumber(7.0))
    assertEquals("5.1", GuideMapping.formatNumber(5.1))
  }

  @Test
  fun numbersUnnumberedChannelsAfterHighestNumber() {
    val rows = GuideMapping.channelRows(listOf(channel("a", 2.0), channel("b"), channel("c", 10.5), channel("d")))
    assertEquals(listOf("2", "11", "10.5", "12"), rows.map { it.displayNumber })
  }

  @Test
  fun numbersFromOneWhenNoChannelHasANumber() {
    val rows = GuideMapping.channelRows(listOf(channel("a"), channel("b")))
    assertEquals(listOf("1", "2"), rows.map { it.displayNumber })
  }

  @Test
  fun matchesProgrammesByTvgIdAcrossChannelsSharingIt() {
    val channels = listOf(channel("hd", tvgId = "bbc1"), channel("sd", tvgId = "bbc1"), channel("other", tvgId = "itv"))
    val rows = GuideMapping.programRows(channels, listOf(programme("bbc1", 0, 10)))
    assertEquals(setOf("hd", "sd"), rows.map { it.channelUuid }.toSet())
  }

  @Test
  fun exactChannelUuidWinsOverTvgId() {
    val channels = listOf(channel("hd", tvgId = "bbc1"), channel("sd", tvgId = "bbc1"))
    val rows = GuideMapping.programRows(channels, listOf(programme("bbc1", 0, 10, channelUuid = "sd")))
    assertEquals(listOf("sd"), rows.map { it.channelUuid })
  }

  @Test
  fun dropsProgrammesForChannelsNotInTheList() {
    val rows = GuideMapping.programRows(
      listOf(channel("fav", tvgId = "fav-tvg")),
      listOf(programme("not-a-favourite", 0, 10), programme("unknown", 0, 10, channelUuid = "elsewhere")),
    )
    assertEquals(emptyList<ProgramRow>(), rows)
  }

  @Test
  fun dedupesWindowOverlapAndDropsOverlappingOrEmptyProgrammes() {
    val channels = listOf(channel("a", tvgId = "a"))
    val rows = GuideMapping.programRows(
      channels,
      listOf(
        programme("a", 20, 30, title = "Second"),
        programme("a", 0, 20, title = "First"),
        programme("a", 0, 20, title = "First"),
        programme("a", 25, 35, title = "Overlaps second"),
        programme("a", 40, 40, title = "Zero length"),
        programme("a", 30, 45, title = "Third"),
      ),
    )
    assertEquals(listOf("First", "Second", "Third"), rows.map { it.title })
  }

  @Test
  fun guideRefreshesWhenChannelsAreAddedOrTheGuideIsStale() {
    val hour = 60 * 60_000L
    assertEquals(true, GuideMapping.guideRefreshDue(0, null, 10 * hour, 4 * hour))
    assertEquals(false, GuideMapping.guideRefreshDue(0, 9 * hour, 10 * hour, 4 * hour))
    assertEquals(true, GuideMapping.guideRefreshDue(1, 9 * hour, 10 * hour, 4 * hour))
    assertEquals(true, GuideMapping.guideRefreshDue(0, 6 * hour, 10 * hour, 4 * hour))
  }

  @Test
  fun diffInsertsUpdatesAndDeletesByUuid() {
    val existing = listOf(
      ExistingChannel(1, ChannelRow("same", "1", "Same", "/logo/1")),
      ExistingChannel(2, ChannelRow("renamed", "2", "Old name", "/logo/2")),
      ExistingChannel(3, ChannelRow("relogo", "3", "Relogo", "/logo/3")),
      ExistingChannel(4, ChannelRow("gone", "4", "Gone", null)),
    )
    val wanted = listOf(
      ChannelRow("same", "1", "Same", "/logo/1"),
      ChannelRow("renamed", "2", "New name", "/logo/2"),
      ChannelRow("relogo", "3", "Relogo", "/logo/33"),
      ChannelRow("new", "5", "New", null),
    )
    val diff = GuideMapping.diff(existing, wanted)
    assertEquals(listOf("new"), diff.insert.map { it.uuid })
    assertEquals(
      listOf(
        ChannelUpdate(2, wanted[1], logoChanged = false),
        ChannelUpdate(3, wanted[2], logoChanged = true),
      ),
      diff.update,
    )
    assertEquals(listOf(4L), diff.delete)
  }
}
