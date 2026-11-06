"""End-to-end over HTTP + WebSocket in demo mode (no external services)."""

from fastapi.testclient import TestClient

from app.main import app

from .conftest import RENT_REQUEST


def _drain_until(ws, predicate, limit=200):
    seen = []
    for _ in range(limit):
        msg = ws.receive_json()
        seen.append(msg)
        if predicate(msg):
            return msg, seen
    raise AssertionError(f"condition not met; last={seen[-3:]}")


def test_full_flow_demo(container):
    client = TestClient(app)
    m = client.post("/api/missions/extract", json={"text": RENT_REQUEST}).json()
    assert client.post("/api/conversations", json={"mission_id": m["id"]}).status_code == 409
    client.post(f"/api/missions/{m['id']}/approve")
    prepared = client.post(f"/api/missions/{m['id']}/prepare").json()
    assert "AI assistant" in prepared["brief"]["opening_statement"]
    conv = client.post("/api/conversations", json={"mission_id": m["id"], "mode": "live"}).json()

    with client.websocket_connect(f"/ws/conversations/{conv['id']}") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot" and snap["state"] == "ready" and snap["demo"]
        ws.send_json({"type": "start"})
        _drain_until(ws, lambda x: x["type"] == "state" and x["state"] == "listening")
        ws.send_json({"type": "counterparty_text", "text": "Rent is ₹35,000, prices went up."})
        msg, _ = _drain_until(ws, lambda x: x["type"] == "transcript.final"
                              and x["event"]["speaker"] == "agent")
        assert "₹30,000" in msg["event"]["text"]
        ws.send_json({"type": "intervene", "text": "Ask if he can include maintenance at ₹32,000."})
        msg, _ = _drain_until(ws, lambda x: x["type"] == "transcript.final"
                              and x["event"]["speaker"] == "agent")
        assert "maintenance" in msg["event"]["text"]
        _drain_until(ws, lambda x: x["type"] == "state" and x["state"] == "listening")
        ws.send_json({"type": "counterparty_text", "text": "Okay, ₹32,000 with maintenance."})
        req, _ = _drain_until(ws, lambda x: x["type"] == "approval.request")
        assert req["approval"]["kind"] == "final_commitment"
        ws.send_json({"type": "approval", "id": req["approval"]["id"], "decision": "approved"})
        _drain_until(ws, lambda x: x["type"] == "approval.resolved")
        ws.send_json({"type": "end"})
        report, _ = _drain_until(ws, lambda x: x["type"] == "report.ready")
        # ₹32,000 is within the limit but misses the ₹30,000 target: not a success.
        assert report["report"]["objective_achieved"] is False

    detail = client.get(f"/api/conversations/{conv['id']}").json()
    kinds = {e["kind"] for e in detail["events"]}
    assert {"speech", "instruction", "approval", "event"} <= kinds
    assert client.get(f"/api/conversations/{conv['id']}/report").status_code == 200
    missions = client.get("/api/missions").json()
    assert missions[0]["status"] == "completed"
