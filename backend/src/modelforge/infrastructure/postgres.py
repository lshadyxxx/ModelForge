from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from modelforge.settings import Settings


def create_pool(settings: Settings) -> ConnectionPool:
    return ConnectionPool(settings.conninfo(), min_size=0, max_size=4, timeout=2,
                          max_waiting=8, reconnect_timeout=4, open=False,
                          # A failed cycle can leave timed-out waiters at the
                          # queue limit. Keep recovery running independently of
                          # new callers so the bounded queue cannot block it.
                          reconnect_failed=ConnectionPool.check,
                          kwargs={"row_factory": dict_row})
