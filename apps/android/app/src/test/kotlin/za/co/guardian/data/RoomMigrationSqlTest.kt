package za.co.guardian.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.sql.DriverManager

class RoomMigrationSqlTest {
    @Test
    fun migratesVersion1Through5AndKeepsExistingRows() {
        Class.forName("org.sqlite.JDBC")
        DriverManager.getConnection("jdbc:sqlite::memory:").use { connection ->
            connection.createStatement().use { statement ->
                statement.execute(
                    "CREATE TABLE IF NOT EXISTS incidents (`triggerId` TEXT NOT NULL, `correlationId` TEXT NOT NULL, `serverId` TEXT, `userId` TEXT NOT NULL, `deviceId` TEXT NOT NULL, `state` TEXT NOT NULL, `isTest` INTEGER NOT NULL, `syncState` TEXT NOT NULL, `createdAtEpochMs` INTEGER NOT NULL, `capsuleJson` TEXT NOT NULL, `lastError` TEXT, PRIMARY KEY(`triggerId`))",
                )
                statement.execute(
                    "CREATE TABLE IF NOT EXISTS locations (`clientPointId` TEXT NOT NULL, `incidentServerId` TEXT NOT NULL, `latitude` REAL NOT NULL, `longitude` REAL NOT NULL, `accuracy` REAL, `speed` REAL, `bearing` REAL, `altitude` REAL, `recordedAt` TEXT NOT NULL, `source` TEXT NOT NULL, `uploaded` INTEGER NOT NULL, PRIMARY KEY(`clientPointId`))",
                )
                statement.execute("CREATE UNIQUE INDEX IF NOT EXISTS `index_locations_clientPointId` ON `locations` (`clientPointId`)")
                statement.execute(
                    "CREATE TABLE IF NOT EXISTS heartbeat_outbox (`clientHeartbeatId` TEXT NOT NULL, `incidentServerId` TEXT NOT NULL, `payloadJson` TEXT NOT NULL, PRIMARY KEY(`clientHeartbeatId`))",
                )
                statement.execute("INSERT INTO incidents VALUES ('t1','c1',null,'u1','d1','SOS',0,'PENDING',1,'{}',null)")
                statement.execute("INSERT INTO locations VALUES ('p1','',-26.2,28.04,null,null,null,null,'2026-10-01T09:00:00.000Z','gps',0)")
                statement.execute("INSERT INTO heartbeat_outbox VALUES ('h1','','{}')")
                GuardianMigrations.sql1to2.forEach { statement.execute(it) }
                GuardianMigrations.sql2to3.forEach { statement.execute(it) }
                GuardianMigrations.sql3to4.forEach { statement.execute(it) }
                statement.executeQuery("SELECT triggerType FROM incidents WHERE triggerId = 't1'").use { rows ->
                    assertTrue(rows.next())
                    assertEquals("MANUAL_SOS", rows.getString(1))
                }
                statement.executeQuery("SELECT localTriggerId FROM locations WHERE clientPointId = 'p1'").use { rows ->
                    assertTrue(rows.next())
                    assertEquals("", rows.getString(1))
                }
                statement.executeQuery("SELECT stage FROM escalation_outbox LIMIT 0").use { }
                statement.execute("INSERT INTO evidence_outbox VALUES ('e1','t1','','audio',0,1,'abc','/tmp','CAPTURED',0,12)")
                GuardianMigrations.sql4to5.forEach { statement.execute(it) }
                statement.executeQuery("SELECT captureId FROM evidence_outbox WHERE evidenceId = 'e1'").use { rows ->
                    assertTrue(rows.next())
                    assertEquals(null, rows.getString(1))
                }
                statement.execute("INSERT INTO tracking_outbox VALUES ('sample-1',X'010203',0,0)")
                statement.executeQuery("SELECT LENGTH(sealed) FROM tracking_outbox").use { rows ->
                    assertTrue(rows.next()); assertEquals(3, rows.getInt(1))
                }
                statement.executeQuery("SELECT COUNT(*) FROM evidence_outbox").use { rows ->
                    assertTrue(rows.next())
                    assertEquals(1, rows.getInt(1))
                }
                statement.executeQuery("PRAGMA table_info(escalation_outbox)").use { rows ->
                    val columns = mutableListOf<String>()
                    while (rows.next()) columns.add(rows.getString("name"))
                    assertTrue(columns.contains("stage"))
                }
            }
        }
        assertEquals(1, GuardianMigrations.MIGRATION_1_2.startVersion)
        assertEquals(5, GuardianMigrations.MIGRATION_4_5.endVersion)
        assertEquals(4, GuardianMigrations.all.size)
    }
}
