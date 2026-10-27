package app.reclinarr.tvinput

import java.time.OffsetDateTime

data class ApiChannel(
  val uuid: String,
  val name: String,
  val number: Double?,
  val logoPath: String?,
  val tvgId: String?,
)

data class ApiProgramme(
  val channelId: String,
  val channelUuid: String?,
  val title: String,
  val description: String?,
  val startMs: Long,
  val endMs: Long,
)

data class ChannelRow(
  val uuid: String,
  val displayNumber: String,
  val displayName: String,
  val logoPath: String?,
)

data class ProgramRow(
  val channelUuid: String,
  val title: String,
  val description: String?,
  val startMs: Long,
  val endMs: Long,
)

data class ExistingChannel(val rowId: Long, val row: ChannelRow)

data class ChannelUpdate(val rowId: Long, val row: ChannelRow, val logoChanged: Boolean)

data class ChannelDiff(
  val insert: List<ChannelRow>,
  val update: List<ChannelUpdate>,
  val delete: List<Long>,
)

/** Pure API → TvContract row mapping; no Android types so it runs as a JVM unit test. */
object GuideMapping {
  fun parseIsoMillis(value: String): Long = OffsetDateTime.parse(value).toInstant().toEpochMilli()

  /** Unnumbered channels are numbered after the highest real number so they never collide. */
  fun channelRows(channels: List<ApiChannel>): List<ChannelRow> {
    var next = (channels.mapNotNull { it.number }.maxOrNull()?.toLong() ?: 0L) + 1
    return channels.map { ch ->
      val number = ch.number?.let(::formatNumber) ?: (next++).toString()
      ChannelRow(ch.uuid, number, ch.name, ch.logoPath)
    }
  }

  fun formatNumber(number: Double): String =
    if (number % 1.0 == 0.0) number.toLong().toString() else number.toString()

  /**
   * Guide items carry tvg_id as channelId; several channels can share one tvg_id (HD/SD variants).
   * An exact channelUuid wins over the tvg_id match. Window fetches overlap at their edges, so
   * items are deduped and any programme starting before the previous one ends is dropped.
   */
  fun programRows(channels: List<ApiChannel>, programmes: List<ApiProgramme>): List<ProgramRow> {
    val uuids = channels.map { it.uuid }.toSet()
    val byTvgId = channels.filter { it.tvgId != null }.groupBy({ it.tvgId!! }, { it.uuid })
    val rows = programmes
      .filter { it.endMs > it.startMs }
      .flatMap { p ->
        val targets = p.channelUuid?.takeIf { it in uuids }?.let(::listOf)
          ?: byTvgId[p.channelId]
          ?: emptyList()
        targets.map { ProgramRow(it, p.title, p.description, p.startMs, p.endMs) }
      }
    return rows
      .groupBy { it.channelUuid }
      .flatMap { (_, channelRows) ->
        val kept = mutableListOf<ProgramRow>()
        for (row in channelRows.sortedBy { it.startMs }) {
          if (kept.isEmpty() || row.startMs >= kept.last().endMs) kept.add(row)
        }
        kept
      }
  }

  /** New channels need programmes, and the guide route can't be filtered per channel, so they force a full refresh. */
  fun guideRefreshDue(insertedChannels: Int, lastGuideSyncMs: Long?, nowMs: Long, maxAgeMs: Long): Boolean =
    insertedChannels > 0 || lastGuideSyncMs == null || nowMs - lastGuideSyncMs >= maxAgeMs

  fun diff(existing: List<ExistingChannel>, wanted: List<ChannelRow>): ChannelDiff {
    val existingByUuid = existing.associateBy { it.row.uuid }
    val wantedUuids = wanted.map { it.uuid }.toSet()
    val insert = wanted.filter { it.uuid !in existingByUuid }
    val update = wanted.mapNotNull { row ->
      val current = existingByUuid[row.uuid] ?: return@mapNotNull null
      if (current.row == row) null
      else ChannelUpdate(current.rowId, row, logoChanged = current.row.logoPath != row.logoPath)
    }
    val delete = existing.filter { it.row.uuid !in wantedUuids }.map { it.rowId }
    return ChannelDiff(insert, update, delete)
  }
}
