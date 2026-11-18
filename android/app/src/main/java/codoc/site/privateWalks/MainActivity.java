package codoc.site.privateWalks;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import codoc.site.privateWalks.recording.WalkRecorderPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PublicSourcesPlugin.class);
        registerPlugin(WalkRecorderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
