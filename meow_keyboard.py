import arcade
#kucing
class MyApplication(arcade.Window):

    def _init_(self, width, height):
        super()._init_(width, height, "triggering sound with all key")

        print("Loading sound...")
        self.laser_sound = arcade.load_sound("gary_meow.mp3")
        print("Sound loaded:", self.laser_sound)

    def on_key_press(self, key, modifiers):
        print(f"Key pressed: {key} > playing sound")
        
        arcade.play_sound(self.laser_sound)

    def on_space_press(self, space, modifiers):
        print(f"Space pressed : {space} > playing sound")

def main():
    window = MyApplication(300, 300)
    arcade.run()

main()