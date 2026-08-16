import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def run():
    engine = create_async_engine('postgresql+asyncpg://atlas_user:IP9DFDMzO-cV6prB5KIYHg@localhost:5432/atlas')
    async with engine.connect() as conn:
        res = await conn.execute(text('SELECT * FROM oauth_token'))
        for row in res.fetchall():
            print(row)
        
        res = await conn.execute(text('SELECT * FROM connector'))
        print("Connectors:")
        for row in res.fetchall():
            print(row)

asyncio.run(run())
